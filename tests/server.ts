import {createServer} from 'http';
import {readFileSync} from 'fs';
import {join} from 'path';

export const createHtmlServer = () => createServer((_, response) => {
	response.setHeader('Content-Type', 'text/html');
	response.end();
}).listen(4444);

export const createXmlServer = () =>  createServer((_, response) => {
	response.setHeader('Content-Type', 'application/xml');
	response.end();
}).listen(4445);

export const createErrorServer = () => createServer((_, response) => {
	response.statusCode = 500;
	response.end();
}).listen(4446);

export const createSitemapIndexServer = () => createServer((_, response) => {
	const indexFile = readFileSync(
		join(__dirname, './files/sitemap_index.xml')
	);
	response.setHeader('Content-Type', 'application/xml');
	response.end(indexFile);
}).listen(4447);

export const createSitemapServer = () => createServer((_, response) => {
	const sitemapFile = readFileSync(
		join(__dirname, './files/sitemap.xml')
	);
	response.setHeader('Content-Type', 'application/xml');
	response.end(sitemapFile);
}).listen(4448);

export const createEmptySitemapServer = () => createServer((_, response) => {
	const sitemapFile = readFileSync(
		join(__dirname, './files/empty.xml')
	);
	response.setHeader('Content-Type', 'application/xml');
	response.end(sitemapFile);
}).listen(4449);