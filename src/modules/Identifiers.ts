export interface ExtractedIdentifiers {
  doi: string;
  pmid: string;
}

export function extractIdentifiersFromTexts(values: Array<string | undefined | null>) {
  let doi = "";
  let pmid = "";

  for (const value of values) {
    if (!value) {
      continue;
    }

    if (!doi) {
      const doiMatch = value.match(/\b10\.\d{4,9}\/[\-._;()/:A-Z0-9]+/i);
      if (doiMatch) {
        doi = doiMatch[0].replace(/[)\].,;]+$/, "");
      }
    }

    if (!pmid) {
      const pmidMatch = value.match(/\bPMID[:\s]*(\d{4,12})\b/i);
      if (pmidMatch) {
        pmid = pmidMatch[1];
      }
    }

    if (doi && pmid) {
      break;
    }
  }

  return { doi, pmid };
}

export function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9一-龥]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleMatches(left: string, right: string) {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length < 16) {
    return longer.includes(shorter);
  }
  return longer.includes(shorter.slice(0, Math.min(shorter.length, 48)));
}

export function filenameLooksLikePdf(name: string) {
  return /\.pdf$/i.test(name);
}
