const http = require('http'),
	express = require('express'),
	EventEmitter = require('events'),
	CircularJSON = require('circular-json'),
	WebSocket = require('ws'),
	WebSocketJSONStream = require('websocket-json-stream'),
	ShareDB = require('sharedb'),
	fs = require('fs'),
	Path = require('path'),
	walk = require('walk'),
	readline = require('readline'),
	os = require('os'),
	BrowserSync = require('browser-sync'),
	exec = require("child_process").exec;

const ports = {sharedb: 8112, websocket: 3000, browsersync: 3001, app: 8080};

class Room extends EventEmitter {

	constructor() {
		super();
		this._emit = this.emit;
		this.emit = this.send;
		this.server = http.createServer();
		this.wss = new WebSocket.Server({server: this.server});
		this.clients = [];
		this.clientTypes = {};
		this.clientsByName = {};
		this.colors = {desktop: '#17ad17', laptop: '#009deb', tablet: '#ff27ff', mobile: '#9900ff', television: '#808080'};

		this.wss.on('connection', (ws, req) => {
			ws.on('message', (message) => {
				try {
					message = CircularJSON.parse(message);
				} catch (e) {
					console.error('Error parsing JSON.', e.message, message);
					return;
				}
				let event = message.shift();
				for (let listener of this.listeners(event)) {
					listener(ws, ...message);
				}
			});
			ws.on('close', () => {
				if (!ws.name) {
					return;
				}
				let name = ws.name;
				delete this.clientsByName[name];
				this.clients.splice(this.clients.map((client) => client.name).indexOf(name), 1);
				this.broadcast(ws, 'clientDisconnected', name);
				console.log('client disconnected:', name);
			});
		});
		this.on('init', (client, data) => {
			let deviceType = data.deviceType;
			if (!data.name || this.clientsByName[data.name]) {
				let count = (this.clientTypes[deviceType] = (this.clientTypes[deviceType] || 0) + 1);
				data.name = (count === 1 ? deviceType : `${deviceType} ${count}`);
			}
			let name = data.name;
			let color = this.colors[deviceType];
			data.color = color;
			this.emit(client, 'init', {name, color, clients: this.clients.filter((client) => !this.clientsByName[client.name].hidden), project: Path.basename(project.rootDir), history: project.history, console: jsConsole.history});
			client.name = name;
			this.clientsByName[name] = client;
			this.clients.push(data);
			this.broadcast(client, 'clientConnected', data);
			console.log('client connected:', name);
		});
		this.on('updateClient', (client, clientName, key, value) => {
			client = this.clientsByName[clientName];
			if (client.hidden) {
				return;
			}
			if (key === 'name') {
				if (this.clientsByName[value]) {
					return;
				}
				this.clientsByName[value] = client;
				delete this.clientsByName[clientName];
				client[key] = value;
			} else if (key === 'views') {
				value[0].time = (new Date).getTime();
			}
			this.clients[this.clients.map((client) => client.name).indexOf(clientName)][key] = value;
			this.broadcast(null, 'clientUpdated', clientName, key, value);
		});
		this.on('hidden', (client, hidden) => {
			client.hidden = hidden;
			if (hidden) {
				this.broadcast(client, 'clientDisconnected', client.name);
			} else {
				this.broadcast(client, 'clientConnected', this.clients[this.clients.map((client) => client.name).indexOf(client.name)]);
			}
		});
		this.on('command', (client, clientName, ...args) => {
			if (!clientName) {
				this.broadcast(client, 'command', ...args);
			} else if (typeof(clientName) === 'string') {
				this.emit(clientName, 'command', ...args);
			} else if (Array.isArray(clientName)) {
				for (clientName of clientName) {
					this.emit(clientName, 'command', ...args);
				}
			}
		});
	}

	listen(port, callback) {
		this.server.listen(port, () => {
			console.log(`WebSocket: listening on port ${port}`);
			callback();
		});
	}

	send(client, ...data) {
		if (typeof(client) === 'string') {
			client = this.clientsByName[client];
		}
		if (!client || client.hidden) {
			return;
		}
		let json;
		try {
			json = CircularJSON.stringify(data);
		} catch (e) {
			console.error('Error creating JSON.', e.message);
			return;
		}
		client.send(json, (error) => {
			if (error) {
				console.error(error);
			}
		});
	}

	broadcast(emitter, ...data) {
		for (let client of this.wss.clients) {
			if (client !== emitter && client.readyState === WebSocket.OPEN) {
				this.emit(client, ...data);
			}
		}
	}

}

class Project {

	constructor(rootDir, port, callback) {
		let sharedb = new ShareDB();

		let connection = sharedb.connect();
		this.connection = connection;
//      sharedb.addProjection('paths', 'files', {path: true});

		this.rootDir = rootDir;
		let readFileContents = true;
		this.loadFromDisk(readFileContents, () => {
//            new Tern.Server({defs: ternDefs, async: true, getFile: (file, callback) => {
//                let doc = this.connection.get('files', file);
//                doc.fetch((error) => {
//                    callback(error, (error ? null : doc.data.content));
//                });
//            }});
			let server = http.createServer();
			let wss = new WebSocket.Server({server: server});
			wss.on('connection', (ws, req) => {
				let stream = new WebSocketJSONStream(ws);
				sharedb.listen(stream);
			});
			if (!readFileContents) {
				sharedb.use('receive', (...args) => { this.onShareDBReceive(...args); });
			}
			this.modifiedDocs = new Set();
			sharedb.use('submit', (...args) => { this.onShareDBSubmit(...args); });
			server.listen(port, () => {
				this.bindToClient(room);
				console.log(`ShareDB: listening on port ${port}`);
				callback();
			});
		});
	}

	bindToClient(room) {
		this.history = [];
		room.on('history', (client, path) => {
			let index = this.history.indexOf(path);
			if (index !== -1) {
				this.history.splice(index, 1);
			}
			this.history.splice(0, 0, path);
			room.broadcast(null, 'history', path);
		});
		room.on('save', (client) => {
			this.saveToDisk(() => {
				room.broadcast(null, 'saved');
			});
		});
		room.on('search', (client, options, clientName) => {
			this.search(options.search, (result) => {
				if (options.replace !== undefined) {
					result.replace = options.replace;
				}
				room.emit(clientName, 'searched', result);
			});
		});
		room.on('replace', (client, matches, search, replace) => {
			this.replace(matches, search, replace, (result) => {
				room.emit(client, 'replaced', result);
			});
		});
	}

	loadFromDisk(readFileContents, callback) {
		this.documents = [];
		walk.walk(this.rootDir, {}).on('node', (root, stat, next) => {
			let path = Path.join(root, stat.name).replace(new RegExp(`\\${Path.sep}`, 'g'), Path.posix.sep);
			let base = Path.basename(path);
			if (['.DS_Store', '.git'].indexOf(base) !== -1) {
				next();
			} else {
			let type = stat.type, extension = Path.extname(path).substr(1);
			let document = {path: path.substr(this.rootDir.length + 1)};
			if (type === 'directory') {
				document.type = type;
			} else if (type === 'file') {
				if (['html', 'js', 'json', 'css', 'php', 'txt', 'md'].indexOf(extension) !== -1) {
					document.type = 'text';
					if (readFileContents) {
						let content = fs.readFileSync(path, 'utf8');
						document.content = content.replace(/\r\n/g, '\n');
					} else {
						document.content = '';
					}
				} else if (['jpg', 'png', 'gif', 'bmp', 'ico'].indexOf(extension) !== -1) {
					document.type = 'image';
				}
			}
			this.documents.push(document);
			next();
			}
		}).on('errors', (root, stats, next) => {
			console.error();
			next();
		}).on('end', () => {
			this.pathsToIds = {};
			this.idsToPaths = {};
			if (this.documents.length === 0) {
				callback();
				return;
			}
			let documentsToCreate = this.documents.length;
			for (let i = 0; i < this.documents.length; i += 1) {
				let id = `${i + 1}`;
				let document = this.documents[i];
				let path = document.path;
				this.idsToPaths[id] = path;
				this.pathsToIds[path] = id;
				this.connection.get('files', id).create(document, (error) => {
					if (error) {
						console.error(error);
					}
					documentsToCreate -= 1;
					if (documentsToCreate === 0) {
						callback();
					}
				});
			}
		});
	}

	saveToDisk(callback) {
		if (this.unsavedDocuments > 0) {
			return;
		}
		if (this.modifiedDocs.size === 0) {
			callback();
			return;
		}
		this.unsavedDocuments = this.modifiedDocs.size;
		for (let modifiedDoc of this.modifiedDocs) {
			let doc = this.connection.get('files', modifiedDoc);
			doc.fetch((error) => {
				if (error) {
					console.error(error);
				} else {
					let absPath = Path.join(this.rootDir, doc.data.path);
					fs.writeFileSync(absPath, doc.data.content, 'utf8');
				}
				this.unsavedDocuments -= 1;
				if (this.unsavedDocuments === 0) {
					callback();
				}
			});
		}
	}

	validatePath(path) {
		path = Path.posix.normalize(path);
		let absPath = Path.join(this.rootDir, path);
		if (!absPath.startsWith(this.rootDir)) {
			throw 'Illegal path.';
		}
		return path;
	}

	getDocument(id, callback) {
		let doc = this.connection.get('files', id);
		doc.fetch((error) => {
			if (error) {
				console.error(error);
				callback(null);
				return;
			}
			if (doc.data.type !== 'text' || doc.data.content) {
				callback(doc);
			} else {
				let absPath = Path.join(this.rootDir, doc.data.path);
				fs.readFile(absPath, 'utf8', (error, data) => {
					let content = data.replace(/\r\n/g, '\n');
					let op = [{p: ['content'], t: 'text0', o: [{p: 0, i: content}]}];
					doc.submitOp(op, (error) => {
						doc.data.content = content;
						callback(doc);
					});
				});
			}
		});
	}

	onShareDBReceive(request, callback) {
		if (request.data.a != 's') {
			callback();
			return;
		}
		let id = request.data.d;
		this.getDocument(id, (doc) => {
			callback();
		});
	}

	onShareDBSubmit(request, callback) {
		let op = request.op;
		let id = request.id;
		if (op.create) {
			let path = op.create.data.path;
			path = this.validatePath(path);
			if (this.pathsToIds[path]) {
				throw `The file ${path} already exists.`;
			}
			let absPath = Path.join(this.rootDir, path);
			let type = op.create.data.type;
			if (type === 'text') {
				fs.writeFileSync(absPath, op.create.data.content, 'utf8');
			} else if (type === 'directory') {
				fs.mkdirSync(absPath);
			}
			op.create.data.path = path;
			this.idsToPaths[id] = path;
			this.pathsToIds[path] = id;
		} else if (op.del) {
			let path = this.idsToPaths[id];
			let absPath = Path.join(this.rootDir, path);
			if (fs.statSync(absPath).isFile()) {
				fs.unlinkSync(absPath);
			} else {
				fs.rmdirSync(absPath);
			}
			delete this.idsToPaths[id];
			delete this.pathsToIds[path];
		} else if (op.op) {
			let p = op.op[0].p[0];
			if (p === 'path') {
				let newPath = op.op[0].o[1].i;
				newPath = this.validatePath(newPath);
				if (this.pathsToIds[newPath]) {
					throw `The file ${newPath} already exists.`;
				}
				let oldPath = this.idsToPaths[id];
				fs.renameSync(Path.join(this.rootDir, oldPath), Path.join(this.rootDir, newPath));
				op.op[0].o[1].i = newPath;
				this.idsToPaths[id] = newPath;
				delete this.pathsToIds[oldPath];
				this.pathsToIds[newPath] = id;
			} else if (p === 'content') {
				this.modifiedDocs.add(id);
			}
		}
		callback();
	}

	search(search, callback) {
		let results = [], matchCount = 0;
		if (search.length === 0) {
			callback({search, results, matchCount});
			return;
		}
		search = search.toLowerCase();
		let left = Object.keys(this.idsToPaths).length;
		let regex = new RegExp(`^.*(${search}).*`, 'igm');
		for (let id in this.idsToPaths) {
			let doc = this.connection.get('files', id);
			doc.fetch((error) => {
				let match, matches;
				if (error) {
					console.error(error);
				} else if (doc.data.content) {
					matches = [];
					while (match = regex.exec(doc.data.content)) {
						let string = match[0];
						let ch = string.toLowerCase().indexOf(search);
						let index = match.index + ch;
						let line = doc.data.content.substr(0, index).split('\n').length - 1;
						matches.push({string, line, ch, index});
						matchCount += 1;
					}
					if (matches.length === 0) {
						matches = null;
					}
				}
				let path = doc.data.path;
				let index = path.indexOf(search);
				if (index !== -1 || matches) {
					let result = {path, version: doc.version};
					if (index !== -1) {
						result.index = index;
					}
					if (matches) {
						result.matches = matches;
					}
					results.push(result);
				}
				left -= 1;
				if (left === 0) {
					results.sort((a, b) => a.path.localeCompare(b.path));
					for (let i = 0; i < results.length; i += 1) {
						let {version, matches} = results[i];
						if (matches) {
							for (let j = 0; j < matches.length; j += 1) {
								matches[j].indexPath = `${i}/${version}/${j}`;
							}
						}
					}
					callback({search, results, matchCount});
				}
			});
		}
	}

	replace(matches, search, replace, callback) {
		if (matches.length === 0) {
			callback({search, replace});
			return;
		}
		let left = 0;
		for (let path in matches) {
			left += matches[path].matches.length;
		}
		let results = [];
		for (let path in matches) {
			let fetchSnapshot = (i) => {
				this.connection.fetchSnapshot('files', this.pathsToIds[path], matches[path].version, (error1, snapshot) => {
					let doc = this.connection.get('files', this.pathsToIds[path]);
					doc.ingestSnapshot(snapshot, (error) => {
						error = error || error1;
						let match = matches[path].matches[i];
						let {index, text} = match;
						let submitCallback = (error) => {
							let result = {indexPath: match.indexPath};
							if (error) {
								console.error(error);
								result.error = error;
							}
							results.push(result);
							left -= 1;
							doc.destroy(() => {
								if (i < matches[path].matches.length - 1) {
									fetchSnapshot(i + 1);
								} else if (left === 0) {
									callback({search, replace, results});
								}
							});
						};
						if (error) {
							submitCallback(error);
						} else {
							let ops = [{p: index, d: text}, {p: index, i: replace}];
							let op = [{p: ['content'], t: 'text0', o: ops}];
							doc.submitOp(op, submitCallback);
						}
					});
				});
			};
			fetchSnapshot(0);
		}
	}

}

class Preview {

	constructor() {
		app.use('/preview', (...args) => { this.servePreview(...args); });
	}

	initBrowserSync(port, callback) {
		let bs = BrowserSync.create();
		bs.watch(project.rootDir).on('change', (event) => {
			event = event.replace(new RegExp(`\\${Path.sep}`, 'g'), Path.posix.sep);
			event = event.substr(event.indexOf('/') + 1);
			bs.reload(event);
		});
		bs.init({port: port, ui: false, logLevel: 'silent', notify: false}, () => {
			console.log(`BrowserSync: listening on port ${port}`);
			callback();
		});
		this.bs = bs;
	}

	servePreview(req, res, next) {
		let path = req._parsedOriginalUrl.pathname;
		path = path.substr(path.indexOf('/', 1) + 1);
		let id = project.pathsToIds[path];
		if (!id) {
			next(id);
			return;
		}
		let extension = Path.extname(path).substr(1);
		if (extension === 'php') {
			exec(`php ${path}`, {cwd: project.rootDir}, (error, stdout, stderr) => {
				console.log(error, stdout, stderr);
				res.send(stdout);
			});
			return;
		}
		project.getDocument(id, (doc) => {
			if (!doc) {
				next();
				return;
			}
			let type = doc.data.type;
			if (type === 'text') {
				let content = doc.data.content;
				if (extension === 'html') {
					let injectHead = `
<script id="_xde_head-script">
	window.addEventListener('message', (event) => {
		if (event.origin === window.location.origin && event.data.eval) {
			var response = {eval: event.data.eval};
			try {
				response.result = eval(event.data.eval);
			} catch (e) {
				response.error = {name: e.name, message: e.message};
			}
			window.parent._xde_postEvalResponse(response);
		}
	});
	window.parent._xde_beforeLoad();
</script>
<style id="_xde_head-style">
	._xde_selected {
		background: rgba(0, 0, 255, 0.65);
	}
</style>
`;
					let injectBody = `
<script id="_xde_body-script">
	document.write('<script id="_xde_browser-sync-script" async src="http://' + location.hostname + ':3001/browser-sync/browser-sync-client.js?v=2.18.12"><' + '/script>');
</script>
`;
					content = content.replace('<head>', '<head>' + injectHead.replace('\n', ''));
					content = content.replace('</body>', injectBody.replace('\n', '') + '</body>');
				}
				res.send(content);
			} else if (type === 'image') {
				res.set('Content-Type', `image/${Path.extname(path).substr(1)}`);
				fs.readFile(Path.join(project.rootDir, path), (err, data) => {
					res.end(data, 'binary');
				});
			} else {
				next();
			}
		});
	}

}

class JSConsole {

	constructor() {
		this.history = [];
		room.on('console', (client, event, ...args) => {
			if (event === 'clear') {
				this.history = [];
			} else {
				this.history.push(args);
			}
			room.broadcast(client, 'console', event, ...args);
		});
	}

}

function initApp(port, callback) {
	let app = express();
	app.use(express.static('dist'));
	app.use(express.static('client'));
	app.use(express.static('node_modules'));
	app.listen(port, () => {
		console.log(`App: listening on port ${port}`);
		callback();
	});
	return app;
}

function registerExitHandler() {
	let rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	process.on('SIGINT', () => {
		if (project.modifiedDocs.size > 0) {
			rl.question('There are unsaved documents. Are you sure you want to quit? (y/n) ', (answer) => {
				if (answer === 'y') {
					process.abort();
				}
			});
		} else {
			process.exit();
		}
	});
	process.on('uncaughtException', (error) => {
		console.error(`\n${error.stack}`);
		if (project.modifiedDocs.size > 0) {
			rl.question('\nThere are unsaved documents. Do you want to save them before aborting? (y/n) ', (answer) => {
				if (answer === 'y') {
					project.saveToDisk(() => {
						process.exit();
					});
				} else {
					process.exit();
				}
			});
		} else {
			process.exit();
		}
	});
}

if (process.argv.length != 3) {
	console.log('Usage: path_to_project');
	process.exit();
}
let projectDir = process.argv[2];
if (!fs.existsSync(projectDir)) {
	console.error(`The path '${projectDir}' does not exist.\n`);
	process.exit();
}

let app, room, project, preview, jsConsole;
app = initApp(ports.app, () => {
	room = new Room();
	project = new Project(projectDir, ports.sharedb, () => {
		preview = new Preview();
		preview.initBrowserSync(ports.browsersync, () => {
			jsConsole = new JSConsole();
			room.listen(ports.websocket, () => {
				let addresses = [];
				let netInterfaces = os.networkInterfaces();
				for (let netInterface in netInterfaces) {
					for (let alias of netInterfaces[netInterface]) {
						if (alias.family === 'IPv4') {
							addresses.push(`${alias.address}:${ports.app}`);
						}
					}
				}
				console.log(`\nAvailable addresses for the clients to connect to:\n${addresses.join('\n')}\n`);
			});
		});
	});
});
//registerExitHandler();
