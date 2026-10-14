import { lookup as dnsLookup, promises as dns, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { buildConnector } from 'undici';

/** Raised when `blockPrivateAddresses` refuses a connection. Never retried. */
export class BlockedAddressError extends Error {
	readonly code = 'ERR_MAPSITE_BLOCKED_ADDRESS';

	constructor(readonly address: string) {
		super(`Refusing to connect to ${address}: not a public address.`);
		this.name = 'BlockedAddressError';
	}
}

// Everything that is not a public unicast address: private networks, loopback,
// link-local (including cloud metadata endpoints), shared, reserved,
// documentation and multicast ranges.
const blocked = new BlockList();
for (const [network, prefix] of [
	['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
	['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
	['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
	['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
	['::', 128], ['::1', 128], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
	['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(network, prefix, 'ipv6');

/** The eight 16-bit groups of an IPv6 address. */
function ipv6Groups(address: string): number[] {
	let text = address.toLowerCase();
	const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
	if (dotted) {
		const [a, b, c, d] = dotted.slice(1).map(Number);
		text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const [head, tail] = text.split('::');
	const left = head ? head.split(':') : [];
	const right = tail ? tail.split(':') : [];
	const zeros = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
	return [...left, ...zeros, ...right].map(group => parseInt(group, 16));
}

const ipv4From = (high: number, low: number) => [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');

/** IPv4 address carried inside an IPv6 one by NAT64 (64:ff9b::/96) or 6to4 (2002::/16). */
function embeddedIPv4(address: string): string | undefined {
	const groups = ipv6Groups(address);
	if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every(group => group === 0)) {
		return ipv4From(groups[6], groups[7]);
	}
	if (groups[0] === 0x2002) return ipv4From(groups[1], groups[2]);
	return undefined;
}

/** Whether `address` (an IP literal) is anything other than a public unicast address. */
export function isPrivateAddress(address: string): boolean {
	const ip = address.replace(/^\[|\]$/g, '').split('%')[0];
	const family = isIP(ip);
	if (family === 4) return blocked.check(ip, 'ipv4');
	if (family !== 6) return false;
	// IPv4-mapped addresses (::ffff:a.b.c.d) are matched against the IPv4 rules by BlockList itself.
	if (blocked.check(ip, 'ipv6')) return true;
	const embedded = embeddedIPv4(ip);
	return embedded !== undefined && blocked.check(embedded, 'ipv4');
}

// Checks every address a hostname resolves to, at connection time, so a
// redirect or a DNS answer that changes between requests cannot slip through.
const guardedLookup: LookupFunction = (hostname, options, callback) => {
	dnsLookup(hostname, options, (error, address, family) => {
		if (error) return callback(error, address, family);
		const addresses: LookupAddress[] = Array.isArray(address) ? address : [{ address, family }];
		const refused = addresses.find(entry => isPrivateAddress(entry.address));
		if (refused) return callback(new BlockedAddressError(refused.address), address, family);
		callback(null, address, family);
	});
};

/** Rejects with `BlockedAddressError` if `hostname` is, or resolves to, a non-public address. */
export async function assertPublicHost(hostname: string): Promise<void> {
	const host = hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(host.split('%')[0]) ? [{ address: host }] : await dns.lookup(host, { all: true });
	const refused = addresses.find(entry => isPrivateAddress(entry.address));
	if (refused) throw new BlockedAddressError(refused.address);
}

/** An undici connector that refuses to open connections to non-public addresses. */
export function guardedConnector(): buildConnector.connector {
	const connect = buildConnector({ lookup: guardedLookup });
	return (options, callback) => {
		// IP literals are connected to without a lookup, so check them here.
		if (isPrivateAddress(options.hostname)) {
			return callback(new BlockedAddressError(options.hostname.replace(/^\[|\]$/g, '')), null);
		}
		connect(options, callback);
	};
}
