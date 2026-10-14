import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '../src/address';

describe('isPrivateAddress', () => {
	it.each([
		'0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
		'172.31.255.255', '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
		'::', '::1', '[::1]', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1',
		'::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1',
		'64:ff9b::a00:1', '64:ff9b::192.168.0.1', '2002:a00:1::', '2001:db8::1',
	])('blocks %s', address => {
		expect(isPrivateAddress(address)).toBe(true);
	});

	it.each([
		'1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8',
		'64:ff9b::808:808', '2002:808:808::',
	])('allows %s', address => {
		expect(isPrivateAddress(address)).toBe(false);
	});

	it('treats hostnames as not an address', () => {
		expect(isPrivateAddress('localhost')).toBe(false);
	});
});
