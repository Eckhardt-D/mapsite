import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {SitemapParser} from '../src';
import {createSitemapServer, createSitemapIndexServer, createEmptySitemapServer} from './server';

describe('SitemapParser', () => {
	it('accepts no options', () => {
		const parser = new SitemapParser();
		expect(parser).toBeInstanceOf(SitemapParser);
	});
});

describe('SitemapParser.run', () => {
	const parser = new SitemapParser({
		maximumDepth: 1,
		rejectInvalidContentType: false
	});

	let xmlFileServer;
	let xmlIndexServer;
	let emptyXmlServer;

	beforeEach(() => {
		xmlFileServer = createSitemapServer(); // 4448
		xmlIndexServer = createSitemapIndexServer(); // 4447
		emptyXmlServer = createEmptySitemapServer(); // 4449
	});

	afterEach(() => {
		xmlFileServer.close();
		xmlIndexServer.close();
		emptyXmlServer.close();
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
			errors: []
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
			errors: []
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
				'Maximum recursive depth reached, more sites available.'
			]
		});
	});

	it('parses all locations of a sitemap index file', async () => {
		parser.maximumDepth = 10;
		const response = await parser.run('https://test.stillio.com/lndbk_/supersitemap.xml');
		expect(response.errors).toStrictEqual([]);
		expect(response.urls.length).toBe(290);
	}, 15000);

	it('does nothing if a sitemap is empty', async () => {
		const response = await parser.run('http://localhost:4449');
		expect(response).toStrictEqual({
			type: 'sitemap',
			errors: [],
			urls: []
		});
	});
});