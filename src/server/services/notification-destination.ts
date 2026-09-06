import "server-only";
import { lookup as nodeLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type ResolveHostname = (hostname: string) => Promise<ResolvedAddress[]>;

export const resolveHostname: ResolveHostname = async (hostname) => {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(normalized);
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: normalized, family: literalFamily }];
  }
  const answers = await nodeLookup(normalized, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
};

const nonPublic = new BlockList();
for (const [network, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"], ["10.0.0.0", 8, "ipv4"], ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"], ["169.254.0.0", 16, "ipv4"], ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"], ["192.0.2.0", 24, "ipv4"], ["192.168.0.0", 16, "ipv4"],
  ["192.88.99.0", 24, "ipv4"],
  ["198.18.0.0", 15, "ipv4"], ["198.51.100.0", 24, "ipv4"], ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"], ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"], ["::1", 128, "ipv6"], ["::", 96, "ipv6"],
  ["64:ff9b:1::", 48, "ipv6"], ["100::", 64, "ipv6"], ["2001:2::", 48, "ipv6"],
  ["2001:10::", 28, "ipv6"],
  ["2001:db8::", 32, "ipv6"], ["3fff::", 20, "ipv6"], ["5f00::", 16, "ipv6"],
  ["fc00::", 7, "ipv6"], ["fe80::", 10, "ipv6"], ["fec0::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
] as const) nonPublic.addSubnet(network, prefix, family);

/**
 * The eight groups of an IPv6 address, whichever way it is spelled: `::`
 * elided, a dotted IPv4 tail, leading zeroes dropped or kept. Null if it is
 * not an IPv6 address at all.
 */
function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address;
  // A dotted tail is the last two groups written as IPv4.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const octets = dotted.slice(1).map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, dotted.index)}${high}:${low}`;
  }
  const [before, after] = text.split("::");
  const head = before ? before.split(":") : [];
  const tail = text.includes("::") ? (after ? after.split(":") : []) : [];
  if (!text.includes("::") && head.length !== 8) return null;
  const groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const parsed = groups.map((group) => Number.parseInt(group || "0", 16));
  return parsed.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? parsed
    : null;
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 one, or null.
 *
 * Decided from the groups rather than from the spelling. `::ffff:127.0.0.1`
 * and `0:0:0:0:0:ffff:7f00:1` are the same address, and a check that
 * recognised only the compressed form let the expanded one past as public —
 * an SMTP host a member could point at the loopback interface.
 */
function mappedIpv4(address: string): string | null {
  const groups = ipv6Groups(address);
  if (!groups) return null;
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (!mapped) return null;
  return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
}

/** True only for globally routable unicast destinations. */
export function isPublicAddress(address: string): boolean {
  try {
    const mapped = mappedIpv4(address);
    if (mapped) return !nonPublic.check(mapped, "ipv4");
    const family = isIP(address);
    return family !== 0 && !nonPublic.check(address, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

export async function validateDestination(
  hostname: string,
  administrative: boolean,
  resolve: ResolveHostname = resolveHostname,
): Promise<ResolvedAddress[]> {
  const answers = await resolve(hostname);
  if (answers.length === 0) throw new Error("The destination hostname did not resolve.");
  if (!administrative && answers.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Only an administrator can use a destination that resolves to a non-public address.");
  }
  return answers;
}
