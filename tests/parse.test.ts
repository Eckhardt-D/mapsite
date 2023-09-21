import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SitemapParser } from '../src';
import { SitemapFetcher } from '../src/fetch';
import {
	createSitemapServer,
	createSitemapIndexServer,
	createEmptySitemapServer,
	createNamespacedServer,
	createMediaServer,
} from './server';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('SitemapParser', () => {
	it('accepts no options', () => {
		const parser = new SitemapParser();
		expect(parser).toBeInstanceOf(SitemapParser);
	});
});

describe('SitemapParser.getLinesFromText', () => {
	it('parses namespaced locations', () => {
		const string = '<ns1:loc>https://location.com</ns1:loc>';
		const result = SitemapParser.getLinesFromText(string);
		expect(result).toStrictEqual(['', '<loc>https://location.com</loc>', '']);
	});

	it('parses line breaks and tabs correctly', () => {
		const string = `\t\t<ns1:loc>
		\t\thttps://location.com
		\t\t</ns1:loc>`;

		const result = SitemapParser.getLinesFromText(string);
		expect(result).toStrictEqual(['', '<loc>https://location.com</loc>', '']);
	});
});

describe('SitemapParser.run', () => {
	const parser = new SitemapParser({
		maximumDepth: 1,
		rejectInvalidContentType: false,
		userAgent: 'Custom',
	});

	let xmlFileServer;
	let xmlIndexServer;
	let emptyXmlServer;
	let namespacedServer;
	let mediaServer;

	beforeEach(() => {
		xmlFileServer = createSitemapServer(); // 4448
		xmlIndexServer = createSitemapIndexServer(); // 4447
		emptyXmlServer = createEmptySitemapServer(); // 4449
		namespacedServer = createNamespacedServer(); // 4450
		mediaServer = createMediaServer(); // 4451
	});

	afterEach(() => {
		xmlFileServer.close();
		xmlIndexServer.close();
		emptyXmlServer.close();
		namespacedServer.close();
		mediaServer.close();
		vi.restoreAllMocks();
	});

	it('returns a list of errors if fetch failed', async () => {
		const error = new Error('error');
		const mock = vi
			.spyOn(SitemapFetcher.prototype, 'fetch')
			.mockRejectedValue(error);

		const response = await parser.run('http://localhost:4448');
		expect(mock).toHaveBeenCalled();
		expect(response).toStrictEqual({
			type: 'sitemap',
			urls: [],
			errors: [
				{
					reason: 'error',
					url: 'http://localhost:4448',
				},
			],
		});
	});

	it('parses a namespaced XML file', async () => {
		const response = await parser.run('http://localhost:4450');
		expect(response).toStrictEqual({
			type: 'sitemap',
			urls: [
				'https://www.onfi.com/',
				'https://www.onfi.com/caregiver-corner',
				'https://www.onfi.com/caregiver-corner/beyond-high-school',
				'https://www.onfi.com/caregiver-corner/brothers-perspective',
				'https://www.onfi.com/caregiver-corner/building-support-network',
				'https://www.onfi.com/caregiver-corner/care-for-the-caregiver',
				'https://www.onfi.com/caregiver-corner/diagnosis-to-management',
				'https://www.onfi.com/caregiver-corner/finding-the-right-neurologist',
				'https://www.onfi.com/caregiver-corner/finding-your-way-with-lgs',
				'https://www.onfi.com/caregiver-corner/healthcare-appointments',
				'https://www.onfi.com/caregiver-corner/legal-guardianship',
				'https://www.onfi.com/caregiver-corner/patient-perspective',
				'https://www.onfi.com/caregiver-corner/protecting-financial-future',
				'https://www.onfi.com/caregiver-corner/role-as-parents',
				'https://www.onfi.com/caregiver-corner/sharing-decision-making',
				'https://www.onfi.com/caregiver-corner/support-for-siblings',
				'https://www.onfi.com/caregiver-corner/seizure-to-lgs',
				'https://www.onfi.com/caregiver-corner/how-the-brain-works',
				'https://www.onfi.com/caregiver-corner/seizure-phases',
				'https://www.onfi.com/caregiver-corner/finding-support',
				'https://www.onfi.com/caregiver-corner/facts-about-lgs',
				'https://www.onfi.com/caregiver-corner/doctor-communication',
				'https://www.onfi.com/caregiver-corner/seizure-triggers',
				'https://www.onfi.com/caregiver-corner/change-resulted-in-relief',
				'https://www.onfi.com/caregiver-corner/conversation',
				'https://www.onfi.com/caregiver-corner/siblings-parents',
				'https://www.onfi.com/caregiver-corner/dont-give-up',
				'https://www.onfi.com/caregiver-corner/managing-lgs-with-doctor',
				'https://www.onfi.com/caregiver-corner/adding-onfi/',
				'https://www.onfi.com/caregiver-corner/when-i-prescribe-onfi',
				'https://www.onfi.com/caregiver-corner/my-life-purpose',
				'https://www.onfi.com/caregiver-corner/advice-for-the-newly-diagnosed',
				'https://www.onfi.com/caregiver-corner/lessons-the-world-could-learn',
				'https://www.onfi.com/copay-card-free-trial',
				'https://www.onfi.com/copay-or-free-trial/patient-assistance',
				'https://www.onfi.com/lennox-gastaut-syndrome',
				'https://www.onfi.com/lennox-gastaut-syndrome/glossary',
				'https://www.onfi.com/managing-lgs',
				'https://www.onfi.com/managing-lgs/childhood-to-adulthood',
				'https://www.onfi.com/managing-lgs/prognosis',
				'https://www.onfi.com/managing-lgs/seizure-management',
				'https://www.onfi.com/managing-lgs/team-of-doctors',
				'https://www.onfi.com/seizure-medication/about',
				'https://www.onfi.com/seizure-medication/dosing',
				'https://www.onfi.com/seizure-medication/reduction-efficacy',
				'https://www.onfi.com/seizure-medication/safety-and-side-effects',
				'https://www.onfi.com/site-map',
				'https://www.onfi.com/search',
			],
			errors: [],
		});
	});

	it('parses a single XML file with default options', async () => {
		const response = await parser.run('http://localhost:4448');
		expect(response).toStrictEqual({
			type: 'sitemap',
			urls: [
				'http://www.example.com/',
				'http://www.example.com/catalog?item=12&amp;desc=vacation_hawaii',
				'http://www.example.com/catalog?item=73&amp;desc=vacation_new_zealand',
				'http://www.example.com/catalog?item=74&amp;desc=vacation_newfoundland',
				'http://www.example.com/catalog?item=83&amp;desc=vacation_usa',
			],
			errors: [],
		});
	});

	it('parses a index XML file with default options', async () => {
		const response = await parser.run('http://localhost:4447');
		expect(response).toStrictEqual({
			type: 'sitemap',
			urls: [
				'http://www.example.com/',
				'http://www.example.com/catalog?item=12&amp;desc=vacation_hawaii',
				'http://www.example.com/catalog?item=73&amp;desc=vacation_new_zealand',
				'http://www.example.com/catalog?item=74&amp;desc=vacation_newfoundland',
				'http://www.example.com/catalog?item=83&amp;desc=vacation_usa',
			],
			errors: [],
		});
	});

	it('does not parse an index XML file with maximumDepth less than last xml loc', async () => {
		parser.maximumDepth = 1;
		const response = await parser.run('http://localhost:4447');
		expect(parser.currentDepth).toBe(1);
		expect(response).toStrictEqual({
			type: 'index',
			urls: [],
			errors: [
				{
					reason: 'Maximum recursive depth reached, more sites available.',
					url: 'http://localhost:4447',
				},
			],
		});
	});

	it('does not parse media-related sitemap tags', async () => {
		parser.maximumDepth = 2;
		const response = await parser.run('http://localhost:4451');
		expect(response.urls).not.includes(
			'https://public.com/wp-content/uploads/2020/05/Community-Roundtable-1.png'
		);
		expect(response.urls).includes(
			'https://public.com/talks/investing-101-workshop'
		);
	});

	it('parses all locations of a sitemap index file', async () => {
		parser.maximumDepth = 10;
		const response = await parser.run(
			'https://test.stillio.com/lndbk_/supersitemap.xml'
		);
		expect(response.errors).toStrictEqual([]);
		expect(response.urls.length).toBe(346);
	}, 15000);

	it('does nothing if a sitemap is empty', async () => {
		const response = await parser.run('http://localhost:4449');
		expect(response).toStrictEqual({
			type: 'sitemap',
			errors: [],
			urls: [],
		});
	});
});

describe('SitemapParser.fromBuffer', () => {
	const parser = new SitemapParser();

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns an error if buffer parsing fails', async () => {
		const buffer = Buffer.from(
			readFileSync(join(__dirname, 'files/sitemap.xml'), {
				encoding: 'binary',
			})
		);

		const mock = vi
			.spyOn(Buffer.prototype, 'toString')
			.mockImplementationOnce(() => {
				throw new Error('BufferError');
			});

		const result = await parser.fromBuffer(buffer);
		expect(mock).toHaveBeenCalled();
		expect(result).toStrictEqual({
			type: 'sitemap',
			urls: [],
			errors: [
				{
					url: 'buffer',
					reason: 'BufferError',
				},
			],
		});
	});

	it('returns an error if something went wrong', async () => {
		const buffer = Buffer.from(
			readFileSync(join(__dirname, 'files/sitemap.xml'), {
				encoding: 'binary',
			})
		);

		const mock = vi
			.spyOn(SitemapParser, 'getLinesFromText')
			.mockImplementationOnce(() => {
				throw new Error('error');
			});

		const result = await parser.fromBuffer(buffer);

		expect(mock).toHaveBeenCalled();
		expect(result).toStrictEqual({
			type: 'sitemap',
			errors: [
				{
					reason: 'error',
					url: 'buffer',
				},
			],
			urls: [],
		});
	});

	it('Parser a sitemap buffer', async () => {
		const buffer = Buffer.from(
			readFileSync(join(__dirname, 'files/sitemap.xml'), {
				encoding: 'binary',
			})
		);

		const result = await parser.fromBuffer(buffer);
		expect(result).toStrictEqual({
			type: 'sitemap',
			urls: [
				'http://www.example.com/',
				'http://www.example.com/catalog?item=12&amp;desc=vacation_hawaii',
				'http://www.example.com/catalog?item=73&amp;desc=vacation_new_zealand',
				'http://www.example.com/catalog?item=74&amp;desc=vacation_newfoundland',
				'http://www.example.com/catalog?item=83&amp;desc=vacation_usa',
			],
			errors: [],
		});
	});
});
