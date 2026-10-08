import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export async function startServer(handler: RequestListener) {
	return listen(createServer(handler));
}

export async function listen(server: Server) {
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		server,
		url,
		close: () => new Promise<void>((resolve, reject) => {
			server.close(error => error ? reject(error) : resolve());
			server.closeAllConnections();
		}),
	};
}

const fixtures = Object.fromEntries([
	'sitemap', 'sitemap_index', 'empty', 'namespaced', 'media', 'edgecase1',
].map(name => [name, readFileSync(join(__dirname, `files/${name}.xml`), 'utf8')]));

export async function startSitemapServer() {
	const fixture = await startServer((request, response) => {
		const name = request.url?.slice(1).replace('.xml', '') || 'sitemap';
		let text = fixtures[name];
		if (text === undefined) {
			response.writeHead(404).end();
			return;
		}
		text = text.replaceAll('http://localhost:4448', fixture.url);
		const zipped = name === 'edgecase1';
		response.setHeader('Content-Type', zipped ? 'application/gzip' : 'application/xml');
		response.end(zipped ? gzipSync(text) : text);
	});
	return fixture;
}
