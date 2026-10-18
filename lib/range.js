/**
 * A small semver range evaluator for plugin compatibility checks.
 *
 * The Host uses this only to *preview* compatibility before handing every
 * install to `pluginManager.installBundle`, which performs the authoritative
 * check with the real semver package. Keeping the preview dependency-free
 * means the bundle does not add a runtime dependency to the profile.
 *
 * Supported syntax: `*`, `x`, exact versions, `=`, `>`, `>=`, `<`, `<=`,
 * `^`, `~`, partial versions (`1`, `1.2`), hyphen ranges and `||`.
 */

const VERSION_RE =
  /^[v=]?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(input) {
  if (typeof input !== 'string') return null;
  const match = VERSION_RE.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const delta = Number(left) - Number(right);
      if (delta !== 0) return delta < 0 ? -1 : 1;
    } else if (leftNumeric) {
      return -1;
    } else if (rightNumeric) {
      return 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left;
  const b = typeof right === 'string' ? parseVersion(right) : right;
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

function parsePartial(token) {
  const match = /^[v=]?\s*(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    token.trim(),
  );
  if (!match) return null;
  const wildMinor = match[2] === undefined || /^[xX*]$/.test(match[2]);
  const wildPatch = match[3] === undefined || /^[xX*]$/.test(match[3]);
  return {
    major: Number(match[1]),
    minor: wildMinor ? 0 : Number(match[2]),
    patch: wildPatch ? 0 : Number(match[3]),
    minorGiven: !wildMinor,
    patchGiven: !wildPatch,
    prerelease: !wildPatch && !wildMinor && match[4] ? match[4].split('.') : [],
  };
}

function versionOf(partial) {
  return {
    major: partial.major,
    minor: partial.minor,
    patch: partial.patch,
    prerelease: partial.prerelease,
  };
}

function atLeast(version, partial) {
  return compareVersions(version, versionOf(partial)) >= 0;
}

function below(version, major, minor, patch) {
  return compareVersions(version, { major, minor, patch, prerelease: [] }) < 0;
}

function matchesCaret(version, partial) {
  if (!atLeast(version, partial)) return false;
  if (!partial.minorGiven) return below(version, partial.major + 1, 0, 0);
  if (partial.major > 0) return below(version, partial.major + 1, 0, 0);
  if (partial.minor > 0) return below(version, 0, partial.minor + 1, 0);
  if (!partial.patchGiven) return below(version, 0, partial.minor + 1, 0);
  return below(version, 0, 0, partial.patch + 1);
}

function matchesTilde(version, partial) {
  if (!atLeast(version, partial)) return false;
  if (!partial.minorGiven) return below(version, partial.major + 1, 0, 0);
  return below(version, partial.major, partial.minor + 1, 0);
}

function matchesBare(version, partial, token) {
  if (!partial.minorGiven) {
    // "1" and "1.x" mean 1.x.
    return atLeast(version, partial) && below(version, partial.major + 1, 0, 0);
  }
  if (!partial.patchGiven) {
    // "1.2" and "1.2.x" mean 1.2.x.
    return atLeast(version, partial) && below(version, partial.major, partial.minor + 1, 0);
  }
  return compareVersions(version, versionOf(partial)) === 0;
}

function matchesComparator(version, token) {
  if (token === '' || token === '*' || /^[xX]$/.test(token)) return true;

  const opMatch = /^(>=|<=|>|<|=)\s*(.+)$/.exec(token);
  if (opMatch) {
    const partial = parsePartial(opMatch[2]);
    if (!partial) return false;
    const delta = compareVersions(version, versionOf(partial));
    if (delta === null) return false;
    switch (opMatch[1]) {
      case '>=':
        return delta >= 0;
      case '>':
        return delta > 0;
      case '<=':
        return delta <= 0;
      case '<':
        return delta < 0;
      default:
        return matchesBare(version, partial, opMatch[2]);
    }
  }

  if (token.startsWith('^')) {
    const partial = parsePartial(token.slice(1));
    return partial ? matchesCaret(version, partial) : false;
  }
  if (token.startsWith('~')) {
    const partial = parsePartial(token.slice(1));
    return partial ? matchesTilde(version, partial) : false;
  }

  const partial = parsePartial(token);
  return partial ? matchesBare(version, partial, token) : false;
}

/**
 * Evaluate `range` against `version`. Returns false for an invalid range or
 * version; the caller decides whether that means "incompatible" or "unknown".
 */
export function satisfies(version, range) {
  const parsed = typeof version === 'string' ? parseVersion(version) : version;
  if (!parsed) return false;
  if (typeof range !== 'string') return false;
  const raw = range.trim();
  if (raw === '') return false;
  if (/^[xX*]$/.test(raw) || raw.toLowerCase() === 'latest') return true;

  return raw.split('||').some((part) => {
    const set = part.trim();
    if (set === '') return true;
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen) {
      const low = parseVersion(hyphen[1]);
      const high = parseVersion(hyphen[2]);
      if (!low || !high) return false;
      return compareVersions(parsed, low) >= 0 && compareVersions(parsed, high) <= 0;
    }
    return set.split(/\s+/).every((token) => matchesComparator(parsed, token));
  });
}

export function isValidRange(range) {
  if (typeof range !== 'string' || range.trim() === '') return false;
  // A range is usable when at least one syntactically valid comparator set exists.
  return range.split('||').some((part) => {
    const set = part.trim();
    if (set === '') return false;
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen) return Boolean(parseVersion(hyphen[1]) && parseVersion(hyphen[2]));
    return set.split(/\s+/).every((token) => {
      if (token === '*' || /^[xX]$/.test(token)) return true;
      const op = /^(>=|<=|>|<|=)\s*(.+)$/.exec(token);
      if (op) return Boolean(parsePartial(op[2]));
      if (token.startsWith('^') || token.startsWith('~')) return Boolean(parsePartial(token.slice(1)));
      return Boolean(parsePartial(token));
    });
  });
}
