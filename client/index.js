require('split-pane');
//require('bootstrap/dist/js/bootstrap.min.js');
var Path = require('path');

// ShareDB and CodeMirror
var CircularJSON = require('circular-json');
var EventEmitter = require('events');
var WebSocket = require('reconnecting-websocket');
var ShareDB = require('sharedb/lib/client');
var CodeMirror = require('codemirror');
var ShareDBCodeMirror = require('sharedb-codemirror');
var ShareDBFileManager = require('./sharedb-filemanager');

var JavaScriptConsole = require('javascript-console');
var DOMInspector = require('dom-inspector');
var acorn = require('acorn');
var css = require('css');
var parse5 = require('parse5');
var hotkeys = require('hotkeys-js');
var cssProperties = require('./CSSProperties.json');

// CodeMirror addons
require('codemirror/mode/javascript/javascript');
require('codemirror/mode/php/php');
require('codemirror/mode/css/css');
require('codemirror/mode/clike/clike');
require('codemirror/mode/xml/xml');
require('codemirror/mode/htmlmixed/htmlmixed');
require('codemirror/mode/markdown/markdown');
require('codemirror/keymap/sublime.js');
require('codemirror/addon/display/panel');
require('codemirror/addon/edit/matchbrackets');
require('codemirror/addon/edit/closebrackets');
require('codemirror/addon/edit/matchtags');
require('codemirror/addon/edit/closetag');
require('codemirror/addon/comment/comment');
require('codemirror/addon/display/panel');
require('codemirror/addon/display/rulers');
require('codemirror/addon/fold/foldcode');
require('codemirror/addon/fold/brace-fold');
require('codemirror/addon/fold/xml-fold');
require('codemirror/addon/fold/foldgutter');
require('codemirror/addon/hint/show-hint');
require('codemirror/addon/hint/css-hint');
require('codemirror/addon/hint/html-hint');
require('codemirror/addon/lint/lint');
require('codemirror/addon/lint/javascript-lint');
require('codemirror/addon/lint/css-lint');
require('codemirror/addon/lint/html-lint');
require('codemirror/addon/search/jump-to-line');
require('codemirror/addon/search/matchesonscrollbar');
require('codemirror/addon/search/search');
require('codemirror/addon/search/searchcursor');
require('codemirror/addon/scroll/annotatescrollbar');
require('codemirror/addon/scroll/simplescrollbars');
require('codemirror/addon/selection/active-line');
require('codemirror/addon/tern/tern');
window.tern = require('tern/lib/tern');
require('tern/lib/condense');
require('tern/lib/signal');
require('tern/lib/def');
require('tern/lib/comment');
require('tern/lib/infer');
var ternDefs = [require('tern/defs/browser.json'), require('tern/defs/ecmascript.json'), require('tern/defs/jquery.json')];

var ports = {sharedb: 8112, websocket: 3000, app: 8080};
var debug = false;
var forceDeviceTypeByName = true;

function log(...args) {
	if (debug) {
		console.debug(...args);
	}
}

function _error(...args) {
	console.error(...args);
}

class Room extends EventEmitter {

	constructor() {
		super();
		this._emit = this.emit;
		this.emit = this.send;
		this.clients = [];
		var ws = new WebSocket(`ws://${window.location.hostname}:${ports.websocket}`);
		this.ws = ws;
		ws.onopen = () => {
			log('WebSocket: connected');
			this.emit('init', settings.values);
			var status = document.getElementById('status');
			status.className = 'fa fa-check-circle';
		};
		ws.onclose = () => {
			log('WebSocket: disconnected');
			var status = document.getElementById('status');
			status.className = 'fa fa-bolt';
		};
		ws.onmessage = (event) => {
			var message;
			try {
				message = CircularJSON.parse(event.data);
			} catch (e) {
				_error('Error parsing JSON.', e.message, event.data);
				return;
			}
			this._emit(...message);
		};

		this.on('init', (data) => {
			log('XDE: init', data);
			this.clients = data.clients;
			if (this.clients.length > 0) {
				document.getElementById('clients').innerHTML = '';
				for (var client of this.clients) {
					document.getElementById('clients').appendChild(sidebar.parseClient(client));
				}
			}
			document.getElementById('project-title').textContent = data.project;
		});
		this.on('clientConnected', (client) => {
			log('XDE: client connected', client);
			if (this.clients.length === 0) {
				document.getElementById('clients').innerHTML = '';
			}
			this.clients.push(client);
			document.getElementById('clients').appendChild(sidebar.parseClient(client));
		});
		this.on('clientUpdated', (clientName, key, value) => {
			log('XDE: client updated', clientName, key, value);
			if (clientName !== settings.values.name) {
				var client = this.getClientByName(clientName);
				client[key] = value;
				if (key === 'name') {
					var oldView = client.view;
					oldView.parentNode.replaceChild(sidebar.parseClient(client), oldView);
				}
			}
		});
		this.on('clientDisconnected', (clientName) => {
			log('XDE: client disconnected', clientName);
			var index = this.clients.map((client) => client.name).indexOf(clientName);
			var client = this.clients[index];
			client.view.parentNode.removeChild(client.view);
			this.clients.splice(index, 1);
			if (this.clients.length === 0) {
				document.getElementById('clients').appendChild(sidebar.emptyClients);
			}
		});
		this.on('command', (...args) => {
			log('XDE: perform command', ...args);
			this._emit(...args);
		});
	}

	send(...args) {
		if (this.ws.readyState !== 1) {
			return;
		}
		var json;
		try {
			json = CircularJSON.stringify(args);
		} catch (e) {
			_error('Error creating JSON.', e.message);
			return;
		}
		this.ws.send(json, (error) => {
			if (error) {
				_error(error);
			}
		});
	}

	command(clientName, command, ...args) {
		log('XDE: send command', clientName, command, ...args);
		if (clientName === null) {
			this._emit(command, ...args);
		}
		this.emit('command', clientName, command, ...args);
	}

	getClientByName(clientName) {
		for (var client of this.clients) {
			if (client.name === clientName) {
				return client;
			}
		}
		if (settings.values.name === clientName) {
			return settings.values;
		}
		return null;
	}

	getClientNameByType(touch) {
		for (var client of this.clients) {
			if (client.touch === touch) {
				return client.name;
			}
		}
		if (settings.values.touch === touch) {
			return settings.values.name;
		}
		return (this.clients.length > 0 ? this.clients[0].name : null);
	}

	getClientNamesByView(view) {
		return this.clients.filter((client) => client.views.map((view) => view.name).indexOf(view) !== -1).map((client) => client.name);
	}

	updateClient(client, key, value) {
		this.emit('updateClient', client.name, key, value);
	}

	renameClient(client) {
		client.view.setAttribute('contenteditable', true);
		client.view.classList.add('renaming');
		client.view.focus();
		inputField(client.view, (name) => {
			client.view.setAttribute('contenteditable', false);
			if (!name) {
				return;
			}
			this.updateClient(client, 'name', name);
		});
	}

}

class Topbar {

	constructor() {
		this.previewButton = document.getElementById('preview-button-top');
		this.previewButton.addEventListener('click', (event) => { preview.open(); });
		this.consoleButton = document.getElementById('console-button-top');
		this.consoleButton.addEventListener('click', (event) => { jsConsole.open(); });
		this.searchButton = document.getElementById('search-button-top');
		this.searchButton.addEventListener('click', (event) => { search.open(); });
		this.bookmarksButton = document.getElementById('bookmarks-button');
		this.bookmarksButton.addEventListener('click', (event) => { bookmarks.open(); });
		this.outlineButton = document.getElementById('outline-button');
		this.outlineButton.addEventListener('click', (event) => { outline.open(); });
		this.settingsButton = document.getElementById('settings-button-top');
		this.settingsButton.addEventListener('click', (event) => { settings.open(); });
	}

	setActiveObject(object) {
		if (this.activeObject) {
			this.activeObject.classList.remove('active');
		}
		if (object) {
			object.classList.add('active');
		}
		this.activeObject = object;
	}

}

class Sidebar {

	constructor() {
		this.objects = {};
		this.nextObjectId = 1;
		this.drag = {
			helper: (event, ui) => {
				var clone = event.currentTarget.cloneNode(true);
				clone.classList.remove('active');
				clone.classList.add('dragging');
				return clone;
			},
			scroll: false
		}
		this.drop = {
			over: (event, ui) => {
				var client = event.target;
				client.style.boxShadow = `0 0 10px ${this.objects[client.dataset.objectId].color}`;
			},
			out: (event, ui) => {
				var client = event.target;
				client.style.boxShadow = '';
			},
			drop: (event, ui) => {
				var item = ui.draggable.get(0);
				var client = event.target;
				client.style.boxShadow = '';
				client = this.objects[client.dataset.objectId];
				if (item.id) {
					var view = item.id.split('-')[0];
					if (view === 'preview') {
						preview.open(null, client.name);
					} else if (view === 'search') {
						search.open(null, client.name);
					} else {
						room.command(client.name, 'openView', view);
					}
				} else {
					var file = fileManager.fileForView(item);
					editor.open(file.doc.data.path, null, client.name);
				}
			}
		}

		this.saveButton = document.getElementById('save-button');
		this.saveButton.addEventListener('click', (event) => { editor.save(); });
		this.playButton = document.getElementById('play-button');
		this.playButton.addEventListener('click', (event) => { preview.quick(); });
		this.quickSearchButton = document.getElementById('quick-search-button');
		this.quickSearchButton.addEventListener('click', (event) => { search.quick(); });
		this.helpButton = document.getElementById('help-button');
		this.helpButton.addEventListener('click', (event) => { help.open(); });
		this.settingsButton = document.getElementById('settings-button');
		this.settingsButton.addEventListener('click', (event) => { settings.open(); });

		this.emptyClients = document.getElementById('clients').firstChild;
		this.bindContextMenu('.client', (target) => this.objects[target.dataset.objectId], [
			['Quick Preview', (client) => { preview.open('index.html', client.name); }],
			['Quick Search', (client) => { search.quick(client.name); }],
			null,
			['Hide Bars', (client) => { room.updateClient(client, 'hideBars', !client.hideBars)}, (client, menuItem) => { return {check: client.hideBars, enable: true}; }],
			null,
			['Rename', (client) => { room.renameClient(client); }]
		]);

		this.previewButton = document.getElementById('preview-button');
		this.previewButton.addEventListener('click', (event) => { preview.open(); });
		$(this.previewButton).draggable(this.drag);
		this.bindContextMenu('#preview-button, #preview-button-top', (target) => preview, [
			['Run', () => { preview.open('index.html'); }],
			['Enable DOM Inspection', () => { preview.toggleDOMInspection(); }, (_, menuItem) => { return {check: preview.DOMInspectionClickListener, enable: preview.view.parentNode && preview.view.style.display === ''}; }],
			['Enable Interactive CSS', () => { preview.toggleInteractiveCSS(); }, (_, menuItem) => { return {check: preview.interactiveCSSClickListener, enable: preview.view.parentNode && preview.view.style.display === ''}; }]
		]);
		this.consoleButton = document.getElementById('console-button');
		this.consoleButton.addEventListener('click', (event) => { jsConsole.open(); });
		$(this.consoleButton).draggable(this.drag);
		this.searchButton = document.getElementById('search-button');
		this.searchButton.addEventListener('click', (event) => { search.open(); });
		$(this.searchButton).draggable(this.drag);

		this.filesView = document.getElementById('files');
		this.filesView.appendChild(fileManager.view());
		fileManager.on('ready', (files) => {
			var expandedDirectories = settings.values.expandedDirectories || [];
			for (var directory of expandedDirectories) {
				fileManager.toggleDirectory(directory, true);
			}
		});
		fileManager.rootFile.view.addEventListener('click', (event) => {
			var file = fileManager.fileForView(event.target);
			if (file.children) {
				fileManager.toggleDirectory(file);
			} else {
				editor.open(file);
			}
		});
		this.bindContextMenu('.file a, #files', (target) => (fileManager.fileForView(target) || fileManager.rootFile), [
			['Preview', (file) => { preview.open(file.doc.data.path); }, (file) => { return {enable: file && !file.children}; }],
			null,
			['New File', (file) => { fileManager.createFileInteractive(file, (path, error) => {
				if (error) {
					alert(error);
				} else {
					setTimeout(() => {
						editor.open(path);
					}, 100);
				}
			}); }],
			['New Folder', (file) => { fileManager.createFolderInteractive(file, (path, error) => {
				if (error) {
					alert(error);
				}
			}); }],
			['Rename', (file) => { fileManager.moveFileInteractive(file, (error) => {
				if (error) {
					alert(error);
				}
			}); }, (file) => { return {enable: file && !file.children}; }],
			['Delete', (file) => {
				if (!confirm('Are you sure you want to delete this file?')) {
					return;
				}
				fileManager.deleteFile(file, (error) => {
					if (error) {
						alert(error);
					}
				});
			}, (file) => { return {enable: file && (!file.children || file.children.length === 0)}; }]
		]);
	}

	parseClient(client) {
		var view = document.createElement('a');
		view.className = 'client';
		view.style.borderColor = client.color;
		var icon = document.createElement('span');
		icon.className = `icon fa fa-${client.deviceType}`;
		view.appendChild(icon);
		var text = document.createTextNode(client.name);
		view.appendChild(text);
		view.dataset.objectId = this.nextObjectId;
		this.objects[this.nextObjectId] = client;
		this.nextObjectId += 1;
		$(view).droppable(this.drop);
		client.view = view;
		return view;
	}

	bindContextMenu(selector, contextFn, menuItems) {
		var context, target;
		var menu = document.createElement('ul');
		menu.className ='dropdown-menu';
		for (let item of menuItems) {
			var itemView = document.createElement('li');
			if (item === null) {
				itemView.className = 'divider';
			} else {
				itemView.innerHTML = `<a href="#">${item[0]}</a>`;
				itemView.addEventListener('click', (event) => {
					menu.parentNode.removeChild(menu);
					target.classList.remove('clicked');
					if (!event.target.classList.contains('disabled')) {
						item[1](context);
					}
				});
			}
			menu.appendChild(itemView);
		}
		document.addEventListener('contextmenu', (event) => {
			target = event.target.closest(selector);
			if (!target) {
				return;
			}
			context = contextFn(target);
			if (target.tagName === 'A') {
				target.classList.add('clicked');
			}
			var disable = (i, child) => {
				var item = menuItems[i];
				if (item === null || item.length < 3) {
					return false;
				}
				var validate = item[2](context, child);
				if (typeof(validate) === 'object') {
					if (validate.hasOwnProperty('check')) {
						var checkImage = child.getElementsByClassName('fa-check')[0];
						if (validate.check) {
							if (!checkImage) {
								var a = child.getElementsByTagName('a')[0];
								checkImage = document.createElement('span');
								checkImage.className = 'fa fa-check';
								a.insertBefore(checkImage, a.firstChild);
							}
						} else {
							if (checkImage) {
								checkImage.parentNode.removeChild(checkImage);
							}
						}
					}
					if (validate.hasOwnProperty('enable')) {
						return !validate.enable;
					}
				}
				return validate;
			};
			for (var i = 0; i < menuItems.length; i += 1) {
				var child = menu.childNodes[i];
				child.classList.toggle('disabled', disable(i, child));
			}
			menu.style.display = 'block';
			menu.style.left = `${event.pageX}px`;
			menu.style.top = `${event.pageY}px`;
			document.body.appendChild(menu);
			document.addEventListener('mousedown', (event) => {
				if (!event.target.closest('.dropdown-menu')) {
					menu.parentNode.removeChild(menu);
					target.classList.remove('clicked');
				}
			}, {once: true});
			event.stopPropagation();
			event.preventDefault();
		});
	}

	setActiveObject(object) {
		if (this.activeObject) {
			this.activeObject.classList.remove('active');
		}
		if (object) {
			object.classList.add('active');
		}
		this.activeObject = object;
	}

}

class Editor {

	constructor() {
		this.view = document.getElementById('editor');
		this.view.controller = this;
		var foldWidget = document.createElement('span');
		foldWidget.className = 'folded';
		foldWidget.innerHTML = '...';
		var codeMirror = new CodeMirror(this.view, {theme: 'mdn-like', keyMap: 'sublime', indentUnit: 4, indentWithTabs: true, lineWrapping: true, lineNumbers: true, matchBrackets: true, autoCloseBrackets: true, matchTags: true, autoCloseTags: true, foldGutter: true, foldOptions: {minFoldSize: 1, widget: foldWidget}, gutters: ['CodeMirror-lint-markers', 'CodeMirror-linenumbers', 'CodeMirror-foldgutter'], hint: true, lint: true, rulers: [81], scrollbarStyle: 'overlay', styleActiveLine: true});
		CodeMirror.commands.find = CodeMirror.commands.findPersistent;
		CodeMirror.commands.findNext = (codeMirror) => { doSearch(codeMirror, false, true, true); };
		CodeMirror.commands.findPersistentPrev = (codeMirror) => { doSearch(codeMirror, true, true, true); };
		CodeMirror.commands.save = (event) => { this.save(); };
		codeMirror.on('gutterClick', (codeMirror, line, gutter, event) => {
			if (event.detail === 1) {
				codeMirror.setSelection({line, ch: 0});
			} else {
				codeMirror.setSelection({line, ch: 0}, {line: line + 1, ch: 0});
			}
		});
		var ternServer = new CodeMirror.TernServer({defs: ternDefs, getFile: (file, callback) => {
			let doc = fileManager.fileAtPath(file).doc;
			doc.fetch((error) => {
				callback(error, (error ? null : doc.data.content));
			});
		}, switchToDoc: (file, doc) => {
			console.log(file, doc);
		}});
		codeMirror.setOption('extraKeys', {
			'Ctrl-Space': (codeMirror) => { ternServer.complete(codeMirror); },
			'Ctrl-I': (codeMirror) => { ternServer.showType(codeMirror); },
			'Cmd-I': (codeMirror) => { ternServer.showType(codeMirror); },
			'Ctrl-O': (codeMirror) => { ternServer.showDocs(codeMirror); },
			'Alt-.': (codeMirror) => { ternServer.jumpToDef(codeMirror); },
			'Alt-,': (codeMirror) => { ternServer.jumpBack(codeMirror); },
			'Ctrl-Q': (codeMirror) => { ternServer.rename(codeMirror); },
			'Ctrl-.': (codeMirror) => { ternServer.selectName(codeMirror); },
			'Cmd-.': (codeMirror) => { ternServer.selectName(codeMirror); }
		});
		hotkeys('ctrl+s, command+s', (event) => { this.save(); event.preventDefault(); });
		hotkeys('ctrl+p, command+p', (event) => { preview.quick(); event.preventDefault(); });
		hotkeys('shift+ctrl+f, shift+command+f', (event) => { search.quick(); event.preventDefault(); });
		hotkeys('ctrl+k, cmd+k', (event) => { jsConsole.clear(); event.preventDefault(); });
		codeMirror.on('inputRead', (codeMirror, change) => {
			if (/^[a-z0-9]+$/i.test(change.text[change.text.length - 1])) {
				var options = {completeSingle: false};
				if (codeMirror.getOption('mode') === 'javascript') {
					options.hint = ternServer.getHint;
				}
				codeMirror.showHint(options);
			}
		});
		codeMirror.on('changes', (codeMirror, changes) => {
			this.validateToolbarButtons();
		});
		codeMirror.on('cursorActivity', (codeMirror) => {
			ternServer.updateArgHints(codeMirror);
			this.updateStats();
		});
		this.ternServer = ternServer;
		$(document).on('click', '.cssName', (event) => {
			var placeholder = codeMirror.findMarksAt(codeMirror.getCursor())[0];
			if (placeholder.className.indexOf('placeholder') != -1) {
				this.selectPlaceholder(placeholder);
			}
		});
//		this.view.addEventListener('click', (event) => {
//			if (!bookmarks.history[0].endsWith('.css') || event.target.classList.contains('fa') || !settings.values.touch) {
//				return;
//			}
//			this.showCSSHint();
//		});
		this.codeMirror = codeMirror;
		this.shareDBCodeMirror = new ShareDBCodeMirror(codeMirror, {verbose: debug, key: 'content'});
		room.on('saved', () => {
			log('XDE: saved');
			sidebar.saveButton.className = 'fa fa-save';
		});
		this.imageViewer = document.getElementById('imageviewer');
		this.imageViewer.controller = this;
	}

//	filesDidChange(action, files) {
//		if (action === 'ready' || action === 'insert') {
//			for (var file of files) {
//				this.ternServer.server.addFile(file.doc.data.path);
//			}
//		} else if (action === 'remove') {
//			for (var file of files) {
//				this.ternServer.server.delFile(file.doc.data.path);
//			}
//		}
//	}

	showToolbar(show) {
		if (show == (this.toolbar !== undefined)) {
			return;
		}
		if (show) {
			var attachToolbarHandler = (className, handler) => {
				this.toolbar.getElementsByClassName(className)[0].addEventListener('click', (event) => {
					codeMirror.getInputField().focus();
					if (event.target.classList.contains('disabled')) {
						return;
					}
					handler();
					this.validateToolbarButtons();
				});
			};
			var codeMirror = this.codeMirror;
			this.toolbar = document.createElement('div');
			this.toolbar.innerHTML = '<div class="toolbar"><span class="fa fa-save"></span><span class="fa fa-undo"></span><span class="fa fa-repeat"></span><span class="spacer"></span><span class="fa fa-arrow-up disabled"></span><span class="fa fa-arrow-down disabled"></span></div>';
			this.toolbar.panel = codeMirror.addPanel(this.toolbar, {position: 'top'});
			attachToolbarHandler('fa-save-alt', (event) => { this.save(); });
			attachToolbarHandler('fa-undo', (event) => { codeMirror.undo(); });
			attachToolbarHandler('fa-repeat', (event) => { codeMirror.redo(); });
			attachToolbarHandler('fa-arrow-up', (event) => {
				this.stackIndex = Math.max(0, this.stackIndex - 1);
				codeMirror.setCursor(this.stack[this.stackIndex]);
			});
			attachToolbarHandler('fa-arrow-down', (event) => {
				this.stackIndex = Math.min(this.stack.length - 1, this.stackIndex + 1);
				codeMirror.setCursor(this.stack[this.stackIndex]);
			});
			var selectorWidget = document.createElement('div');
			selectorWidget.className = 'selectorWidget';
			selectorWidget.innerHTML = '<a href="#" class="addRule">Add new rule</a></div>';
			selectorWidget.getElementsByClassName('addRule')[0].addEventListener('click', (event) => {
				var line = selectorWidget.line + 1;
				codeMirror.replaceRange('color: red;\n', {line, ch: 0});
				var placeholder = codeMirror.markText({line, ch: 0}, {line, ch: 5}, {atomic: true, className: 'placeholder cssName'});
				codeMirror.markText({line, ch: 7}, {line, ch: 10}, {atomic: true, className: 'placeholder cssValue'});
				codeMirror.indentLine(line);
				selectorWidget.parentNode.removeChild(selectorWidget);
				this.selectPlaceholder(placeholder);
			});
			this.selectorWidget = selectorWidget;
			this.colorPicker = document.createElement('input');
			this.colorPicker.type = 'text';
			this.cssProperties = [];
			for (var property in document.body.style) {
				if (!document.body.style.hasOwnProperty(property)) {
					continue;
				}
				property = property.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
				if (property.startsWith('webkit')) {
					property = `-${property}`;
				}
				this.cssProperties.push(property);
			}
		} else {
			this.toolbar.panel.clear();
			delete this.toolbar;
		}
	}

	showStatusbar(show) {
		if (show == (this.statusbar !== undefined)) {
			return;
		}
		if (show) {
			this.statusbar = document.createElement('div');
			this.statusbar.className = 'status-bar';
			this.statusbar.panel = this.codeMirror.addPanel(this.statusbar, {position: 'bottom'});
		} else {
			this.statusbar.panel.clear();
			delete this.statusbar;
		}
	}

	open(file, options, clientName) {
		if (!file) {
			return;
		}
		if (clientName !== undefined && clientName !== settings.values.name) {
			var path = (typeof(file) === 'string' ? file : file.doc.data.path);
			room.command(clientName, 'openView', 'editor', {path, options});
			return;
		}
		if (typeof(file) === 'string' && !(file = fileManager.fileAtPath(file))) {
			return;
		}
		options = options || {};
		var doc = file.doc;
		var type = doc.data.type;
		var path = doc.data.path;
		if (type === 'text') {
			fileManager.toggleDirectory(file.parent, true, true);
			var finish = () => {
				var codeMirror = this.codeMirror;
				if (!settings.values.touch) {
					codeMirror.getInputField().focus();
				}
				var modes = {html: 'htmlmixed', js: 'javascript', json: 'application/json', css: 'css', php: 'application/x-httpd-php', md: 'text/x-markdown'};
				codeMirror.setOption('mode', modes[Path.extname(path).substr(1)]);
				codeMirror.setOption('lint', false);
				codeMirror.setOption('lint', true);
				if (options.hasOwnProperty('selection')) {
					var selection = options.selection;
					codeMirror.setCursor((typeof(selection) === 'number' ? codeMirror.posFromIndex(selection) : selection));
				} else {
					codeMirror.setCursor({line: 0, ch: 0});
				}
				delete this.stack;
				delete this.stackIndex;
				if (options.stack) {
					this.stack = options.stack;
					this.stackIndex = this.stack.length - 1;
					codeMirror.setCursor(this.stack[this.stackIndex]);
				}
				this.validateToolbarButtons();
				this.updateStats();
			};
			if (file === sidebar.activeObject) {
				finish();
			} else {
				this.activeObjects = {sidebar: file.view};
				activateView(this.view);
				this.showToolbar(settings.values.touch || options.stack !== undefined);
				this.showStatusbar(true);
				this.shareDBCodeMirror.attachDoc(doc, (error) => {
					if (error) {
						alert(error);
						return;
					}
					finish();
				});
			}
		} else if (type === 'image') {
			this.activeObjects = {sidebar: file.view};
			activateView(this.imageViewer);
			this.imageViewer.style.backgroundImage = `url(${preview.url + path}), repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 10px, rgba(255, 255, 255, 0.1) 10px, rgba(255, 255, 255, 0.1) 20px)`;
		}
		if (bookmarks.history.length === 0 || path !== bookmarks.history[0]) {
			room.emit('history', path);
		}
	}

	validateToolbarButtons() {
		if (!this.toolbar) {
			return;
		}
		for (var button of Array.from(this.toolbar.getElementsByClassName('fa'))) {
			button.classList.remove('disabled');
		}
		if (this.codeMirror.historySize().undo === 0) {
			this.toolbar.getElementsByClassName('fa-undo')[0].classList.add('disabled');
		}
		if (this.codeMirror.historySize().redo === 0) {
			this.toolbar.getElementsByClassName('fa-repeat')[0].classList.add('disabled');
		}
		if (this.hasOwnProperty('stackIndex')) {
			if (this.stackIndex === 0) {
				this.toolbar.getElementsByClassName('fa-arrow-up')[0].classList.add('disabled');
			}
			if (this.stackIndex === this.stack.length - 1) {
				this.toolbar.getElementsByClassName('fa-arrow-down')[0].classList.add('disabled');
			}
		} else {
			for (var button of [this.toolbar.getElementsByClassName('fa-arrow-up')[0], this.toolbar.getElementsByClassName('fa-arrow-down')[0]]) {
				button.classList.add('disabled');
			}
		}
	}

	close() {
		this.shareDBCodeMirror.detachDoc();
	}

	showCSSHint() {
		var codeMirror = this.codeMirror;
		if (this.selectorWidget.widget) {
			this.selectorWidget.widget.clear();
			delete this.selectorWidget.widget;
		}
		if (this.colorPicker.widget) {
			$(this.colorPicker).spectrum('hide');
			$(this.colorPicker).spectrum('destroy');
			this.colorPicker.widget.clear();
			delete this.colorPicker.widget;
		}
		function propertyAt(cursor) {
			if (cursor.ch === codeMirror.getLineHandle(cursor.line).text.length) {
				return;
			}
			var tokens = codeMirror.getLineTokens(cursor.line);
			var property = {};
			for (var token of tokens) {
				if (token.type === 'property') {
					property.name = token.string;
				} else if (token.type !== null) {
					property.value = token.string;
					property.start = token.start;
					property.end = token.end;
				}
			}
			return (property.name && property.value ? property : null);
		}
		var cursor = codeMirror.getCursor();
		var property = propertyAt(cursor);
		if (property) {
			var name = property.name;
			var from = {line: cursor.line, ch: property.start}, to = {line: cursor.line, ch: property.end};
			var values = cssProperties[name].values;
			if (name.endsWith('color')) {
				this.colorPicker.widget = codeMirror.addLineWidget(cursor.line, this.colorPicker);
				$(this.colorPicker).spectrum({flat: true, showButtons: false, color: codeMirror.getRange(from, to), change: (color) => {
					codeMirror.replaceRange(color.toHexString(), from, to);
				}});
			} else if (values) {
				codeMirror.showHint({hint: (codeMirror, options) => {
					return {list: values, from, to, selectedHint: Math.max(0, values.indexOf(property.value))};
				}});
			}
			return;
		}
		var line = codeMirror.getLine(cursor.line).trim();
		if (line.endsWith('{') && !line.startsWith('@')) {
			this.selectorWidget.widget = codeMirror.addLineWidget(cursor.line, this.selectorWidget);
			this.selectorWidget.line = cursor.line;
			return;
		}
	}

	selectPlaceholder(placeholder) {
		this.codeMirror.showHint({hint: (codeMirror, options) => {
			var range = placeholder.find();
			return {list: this.cssProperties, from: range.from, to: range.to};
		}});
	}

	updateStats() {
		var cursor = this.codeMirror.getCursor();
		var column = CodeMirror.countColumn(this.codeMirror.getLine(cursor.line), cursor.ch, this.codeMirror.getOption('indentUnit'));
		this.statusbar.innerHTML = `Line ${cursor.line + 1}, column ${column + 1}<span class="disabled"> - ${this.codeMirror.lineCount()} lines</span>`;
	}

	save() {
		sidebar.saveButton.className = 'fa fa-spin fa-spinner';
		room.emit('save');
	}

}

class Preview {

	constructor() {
		this.view = document.getElementById('preview');
		this.view.controller = this;
		this.view.src = 'about:blank';
		this.last = null;
		this.url = `${window.location.origin}/preview/`;
		room.on('clientUpdated', (clientName, key, value) => {
			if (key === 'views' && this.DOMObserver) {
				var isSelf = clientName === settings.values.name;
				if (value.map((view) => view.name).indexOf((isSelf ? 'preview' : 'outline')) === -1) {
					this.DOMObserver.stopMutationObserver();
				} else {
					if (isSelf) {
						var clients = room.getClientNamesByView('outline');
						if (clients.length > 0) {
							this.DOMObserver.startMutationObserver();
							var outline = this.DOMObserver.tree();
							room.command(clients, 'openView', 'outline', {outline});
						}
					} else if (this.view.parentNode && this.view.style.display === '') {
						this.DOMObserver.startMutationObserver();
						var outline = this.DOMObserver.tree();
						room.command(clientName, 'openView', 'outline', {outline});
					}
				}
			}
		});
		window._xde_beforeLoad = () => {
			delete this.highlightedElement;
			delete this.DOMInspectionClickListener;
			delete this.interactiveCSSClickListener;
			jsConsole.attachToWindow(this.view.contentWindow);
			jsConsole.setClientId(this.view.contentWindow, settings.values.name);
			this.view.contentWindow.addEventListener('load', (event) => {
				this.DOMObserver = new DOMInspector.Observer(this.view.contentDocument, {highlightClass: '_xde_selected'});
				this.DOMObserver.initMutationObserver((updates) => {
					var clients = room.getClientNamesByView('outline');
					if (clients.length > 0) {
						room.command(clients, 'openView', 'outline', {updates});
					}
				});
				if (!(this.view.parentNode && this.view.style.display === '')) {
					return;
				}
				var clients = room.getClientNamesByView('outline');
				if (clients.length > 0) {
					var outline = this.DOMObserver.tree();
					room.command(clients, 'openView', 'outline', {outline});
					this.DOMObserver.startMutationObserver();
				}
			});
		};
		window._xde_postEvalResponse = (data) => {
			var args;
			if (data.error) {
				args = [`${data.eval}:`, `${data.error.name}: ${data.error.message}`];
			} else if (data.result) {
				args = [`${data.eval}:`, data.result];
			} else {
				args = [data.eval];
			}
			jsConsole.append(settings.values.name, 'code', null, ...args);
		}
		room.on('eval', (code) => { this.evalCode(code); });
		room.on('highlightPreview', (element) => { this.highlightElement(element); });
		room.on('inspectCSS', (cascade) => { this.inspectCSS(cascade); });
	}

	open(file, clientName) {
		var path = file;
		if (typeof(file) === 'Doc') {
			path = file.doc.data.path;
		}
		if (clientName !== undefined && clientName !== settings.values.name) {
			room.command(clientName, 'openView', 'preview', {path});
		} else {
			if (path) {
				this.view.src = this.url + path;
			} else if (this.view.src === 'about:blank') {
				path = 'index.html';
				this.view.src = this.url + path;
			}
			this.activeObjects = {topbar: topbar.previewButton, sidebar: sidebar.previewButton};
			activateView(this.view);
		}
		if (path) {
			this.last = {path, clientName};
		}
	}

	quick() {
		if (this.last && room.getClientByName(this.last.clientName)) {
			this.open(this.last.path, this.last.clientName);
		} else {
			this.open('index.html');
		}
	}

	evalCode(code, clientName) {
		if (clientName !== undefined && clientName !== settings.values.name) {
			room.command(clientName, 'eval', code);
		} else if ((this.view.parentNode && this.view.style.display === '') || (this.last && !this.last.clientName)) {
			this.view.contentWindow.postMessage({eval: code}, window.location.origin);
		}
	}

	toggleDOMInspection() {
		if (!this.DOMInspectionClickListener) {
			this.DOMInspectionClickListener = (event) => {
				room.command(room.getClientNamesByView('outline'), 'outlineSelect', this.DOMObserver.pathForNode(event.target));
			};
			this.view.contentDocument.addEventListener('click', this.DOMInspectionClickListener);
		} else {
			this.view.contentDocument.removeEventListener('click', this.DOMInspectionClickListener);
			delete this.DOMInspectionClickListener;
		}
	}

	toggleInteractiveCSS() {
		if (!this.interactiveCSSClickListener) {
			CSSUtilities.define('page', this.view.contentDocument);
			this.interactiveCSSClickListener = (event) => {
				var cascade = CSSUtilities.getCSSRules(event.target);
				for (var rule of cascade) {
					rule.href = rule.href.substr(this.url.length);
				}
				this.inspectCSS(cascade, room.getClientNameByType(false));
			};
			this.view.contentDocument.addEventListener('click', this.interactiveCSSClickListener);
		} else {
			this.view.contentDocument.removeEventListener('click', this.interactiveCSSClickListener);
			delete this.interactiveCSSClickListener;
		}
	}

	inspectCSS(cascade, clientName) {
		if (clientName !== undefined && clientName !== settings.values.name) {
			room.command(clientName, 'inspectCSS', cascade);
			return;
		}
		var path = cascade[cascade.length - 1].href;
		var file = fileManager.fileAtPath(path);
		var plainRules = [];
		var rules = css.parse(file.doc.data.content).stylesheet.rules;
		for (var rule of rules) {
			if (rule.rules) {
				plainRules.push(...rule.rules);
			} else if (rule.type === 'rule') {
				plainRules.push(rule);
			}
		}
		var stack = [];
		function isActiveRule(rule) {
			for (var name in rule.properties) {
				if (rule.properties[name].status !== 'active') {
					return false;
				}
			}
			return true;
		}
		for (var rule of cascade) {
			if (!isActiveRule(rule)) {
				continue;
			}
			var position = plainRules[rule.index - 1].position.start;
			stack.push({line: position.line - 1, ch: position.column - 1});
		}
		if (clientName !== undefined && clientName !== settings.values.name) {
			editor.open(path, {stack}, clientName);
		} else {
//			settings.split('v');
//			activeContainer = document.getElementById('right-component');
			editor.open(path, {stack});
			temporarySplit = true;
		}
	}

	highlightElement(element, clientName) {
		if (clientName !== undefined && clientName !== settings.values.name) {
			room.command(clientName, 'highlightPreview', element);
		} else if (this.view.parentNode && this.view.style.display === '') {
			this.DOMObserver.highlightElement(element);
		}
	}

}

class JSConsole extends JavaScriptConsole {

	constructor() {
		super(document.getElementById('console'), {
			beforeAppend: (clientId, type, stack, ...args) => {
				if (stack) {
					for (var call of stack) {
						var fileName = call.fileName;
						if (fileName && fileName.startsWith(preview.url)) {
							call.fileName = fileName.substr(preview.url.length);
						}
					}
				}
				room.emit('console', 'append', clientId, type, stack, ...args);
			},
			afterClear: () => {
				room.emit('console', 'clear');
			},
			onCodeInput: (code) => {
				preview.evalCode(code, null);
			},
			onFilerefClick: (fileref) => {
				editor.open(fileref.fileName, {selection: {line: fileref.lineNumber - 1, ch: fileref.columnNumber - 1}}, room.getClientNameByType(false));
			}
		});
		this.view.controller = this;
		room.on('init', (data) => {
			for (var client of room.clients) {
				this.setColor(client.name, client.color);
			}
			this.useCallbacks = false;
			this.clear();
			for (var line of data.console || []) {
				this.append(...line);
			}
			this.useCallbacks = true;
			this.clientId = settings.values.name;
			this.setColor(settings.values.name, 'black');
		});
		room.on('clientConnected', (client) => {
			this.setColor(client.name, client.color);
		});
		room.on('clientUpdated', (clientName, key, value) => {
			if (key === 'name') {
				if (clientName === settings.values.name) {
					this.clientId = value;
					this.setColor(value, 'black');
				} else {
					var client = room.getClientByName(value);
					this.setColor(value, client.color);
				}
			}
		});
		room.on('clientDisconnected', (clientName) => {
			this.setColor(clientName, null);
		});
		room.on('console', (event, ...args) => {
			this.useCallbacks = false;
			if (event === 'append') {
				this.append(...args);
			} else if (event === 'clear') {
				this.clear();
			}
			this.useCallbacks = true;
		});
		if (debug) {
			this.attachToWindow(window);
		}
	}

	open() {
		this.activeObjects = {topbar: topbar.consoleButton, sidebar: sidebar.consoleButton};
		activateView(this.view);
		this.scrollToBottom();
	}

}

class Search {

	constructor() {
		this.view = document.getElementById('search');
		this.view.controller = this;
		this.last = null;
		this.replaceInput = document.getElementById('replace-input');
		this.replaceInput.parentNode.style.display = 'none';
		this.selectedButton = document.getElementById('mode-search');
		document.getElementById('mode-selector').addEventListener('click', (event) => {
			this.replaceInput.value = '';
			this.selectModeButton(event.target);
		});
		this.searchInput = document.getElementById('search-input');
		this.view.addEventListener('keydown', (event) => {
			if (event.keyCode === 13) {
				var options = {search: this.searchInput.value};
				if (this.selectedButton.id === 'mode-replace') {
					options.replace = this.replaceInput.value;
				}
				room.emit('search', options, settings.values.name);
			}
		});
		room.on('searched', (...args) => {
			this.open(...args);
		});
		this.view.addEventListener('click', (event) => {
			var target = event.target, newTarget;
			if (target.type === 'checkbox') {
				if (target.parentNode.classList.contains('file')) {
					for (var checkbox of Array.from(target.parentNode.nextSibling.getElementsByTagName('INPUT'))) {
						checkbox.checked = target.checked;
					}
				}
			} else if ((newTarget = target.closest('.file'))) {
				var icon = newTarget.querySelector('.fa');
				icon.classList.toggle('fa-caret-down');
				icon.classList.toggle('fa-caret-right');
				newTarget.nextSibling.classList.toggle('expanded');
			} else if ((newTarget = target.closest('.line'))) {
				if (this.selectedRow) {
					this.selectedRow.classList.remove('selected');
				}
				newTarget.classList.add('selected');
				this.selectedRow = newTarget;
				var [file, match] = newTarget.dataset.indexPath.split('/');
				file = this.results[file], match = file.matches[match];
				editor.open(file.path, {selection: match.index}, room.getClientNameByType(false));
			}
		});
		room.on('replaced', (...args) => {
			this.updateReplaceResults(...args);
		});
	}

	selectModeButton(target) {
		this.selectedButton.classList.remove('active');
		target.classList.add('active');
		this.selectedButton = target;
		this.replaceInput.parentNode.style.display = (target.id === 'mode-replace' ? '' : 'none');
	}

	open(options, clientName) {
		if (clientName !== undefined && clientName !== settings.values.name) {
			room.command(clientName, 'openView', 'search', {options});
		} else {
			this.activeObjects = {topbar: topbar.searchButton, sidebar: sidebar.searchButton};
			activateView(this.view);
			if (!options || !options.search) {
				return;
			}
			var {search, results, replace} = options;
			var isReplace = replace !== undefined;
			this.results = results;
			this.searchInput.value = search;
			this.replaceInput.value = replace;
			this.selectModeButton(document.getElementById((isReplace ? 'mode-replace' : 'mode-search')));
			if (this.headerView) {
				this.view.removeChild(this.headerView);
				this.view.removeChild(this.resultsView);
			}
			var headerView = document.createElement('div');
			headerView.className = 'header';
			headerView.textContent = `${(isReplace ? `Replace "${search}" with "${replace}"` : `Found "${search}"`)}: ${options.matchCount} matches in ${results.length} files`;
			if (isReplace) {
				var replaceAll = document.createElement('a');
				replaceAll.id ='replace-all';
				replaceAll.className = 'btn btn-primary right';
				replaceAll.innerHTML = 'Replace all';
				headerView.appendChild(replaceAll);
				replaceAll.addEventListener('click', (event) => {
					var matches = {};
					for (var checkbox of Array.from(this.view.querySelectorAll('.line input:checked'))) {
						var line = checkbox.parentNode;
						var indexPath = line.dataset.indexPath;
						var [file, match] = indexPath.split('/');
						file = this.results[file], match = file.matches[match];
						if (!matches[file.path]) {
							matches[file.path] = [];
						}
						matches[file.path].push({indexPath, index: match.index, text: match.string.substr(match.ch, search.length)});
					}
					room.emit('replace', matches, search, replace);
				});
			}
			this.view.appendChild(headerView);
			this.headerView = headerView;
			var resultsView = document.createElement('div');
			resultsView.className = 'results';
			var temp = document.createElement('div');
			var safeString = (string) => {
				temp.textContent = string;
				string = temp.innerHTML;
				return string;
			}
			var parseMatch = (string, index, search) => {
				return `<span>${safeString(string.substr(0, index).replace(/^\s+/, ''))}</span><span class="match">${safeString(string.substr(index, search.length))}</span><span>${safeString(string.substr(index + search.length).replace(/\s+$/, ''))}</span>`;
			};
			for (var result of results) {
				var {index, path} = result;
				var fileView = `<a href="#" class="file">${(isReplace ? '<input type="checkbox" class="btn btn-default" checked />' : '')}<span class="fa fa-caret-down"></span>${(index !== undefined ? parseMatch(path, index, search) : path)}</a>`;
				var matches = '';
				if (result.matches) {
					for (var match of result.matches) {
						var {string, line, ch, indexPath} = match;
						matches += `<a href="#" data-index-path="${indexPath}" class="line">${(isReplace ? '<input type="checkbox" class="btn btn-default" checked />' : '')}<span class="number">${line + 1}</span>${parseMatch(string, ch, search)}</a>`;
					}
				}
				matches = `<div class="children expanded">${matches}</div>`;
				var matchesView = document.createElement('div');
				matchesView.innerHTML = fileView + matches;
				resultsView.appendChild(matchesView);
			}
			this.view.appendChild(resultsView);
			this.resultsView = resultsView;
		}
		this.last = {clientName};
	}

	updateReplaceResults(result) {
		this.open();
		var errors = 0;
		var results = result.results;
		for (var result of results) {
			if (result.error) {
				errors += 1;
			}
			var line = this.view.querySelector(`[data-index-path="${result.indexPath}"]`);
			var icon = document.createElement('span');
			icon.className = 'icon fa ' + (result.error ? 'fa-times-circle' : 'fa-check-circle');
			line.replaceChild(icon, line.firstChild);
		}
		this.headerView.textContent = `Replaced ${results.length - errors} out of ${results.length} selected matches`;
		var icon = document.createElement('span');
		icon.className = 'icon fa ' + (errors > 0 ? 'fa-times-circle' : 'fa-check-circle');
		this.headerView.insertBefore(icon, this.headerView.firstChild);
	}

	quick(clientName) {
		var search = prompt('Search in project: ');
		if (!search) {
			return;
		}
		if (!clientName) {
			if (this.last && room.getClientByName(this.last.clientName)) {
				clientName = this.last.clientName;
			} else {
				clientName = room.getClientNameByType(true) || settings.values.name;
			}
		}
		room.emit('search', {search}, clientName);
		this.last = {clientName};
	}

}

class Bookmarks {

	constructor() {
		this.view = document.getElementById('bookmarks');
		this.view.controller = this;
		this.history = [];
		this.historyView = this.view.getElementsByClassName('history')[0];
		this.emptyHistory = document.getElementById('empty-history');
		this.historyView.removeChild(this.emptyHistory);
		room.on('init', (data) => {
			this.history = data.history;
		});
		this.searchInput = this.view.getElementsByClassName('search')[0];
		this.searchInput.addEventListener('keyup', (event) => {
			this.filter(event.target.value.toLowerCase());
		});
		this.view.addEventListener('click', (event) => {
			var target = event.target, newTarget;
			if ((newTarget = target.closest('.file'))) {
				var path = newTarget.dataset.path;
				editor.open(path, {}, room.getClientNameByType(false));
			}
		});
		room.on('history', (path) => {
			this.updateHistory(path);
		});
	}

	open() {
		if (!this.historyView.hasChildNodes()) {
			if (this.history.length === 0) {
				this.historyView.appendChild(this.emptyHistory);
			} else {
				for (var file of this.history.map((path) => this.parseBookmark(path))) {
					this.historyView.appendChild(file);
				}
			}
		}
		this.activeObjects = {topbar: topbar.bookmarksButton};
		activateView(this.view);
	}

	parseBookmark(path) {
		var extension = Path.extname(path).substr(1);
		var file = document.createElement('a');
		file.className = 'file';
		file.dataset.path = path;
		file.innerHTML = `<span class="icon ${extension}">${extension}</span><span class="name">${Path.basename(path, Path.extname(path))}<span class="extension">${Path.extname(path)}</span></span>`;
		return file;
	}

	updateHistory(path) {
		var index = this.history.indexOf(path);
		if (index !== -1) {
			this.history.splice(index, 1);
		}
		this.history.splice(0, 0, path);
		if (!this.historyView.hasChildNodes()) {
			return;
		}
		var element = this.parseBookmark(path);
		if (index !== -1) {
			this.historyView.removeChild(this.historyView.childNodes[index]);
		}
		if (this.history.length === 0) {
			this.historyView.append(element);
		} else {
			this.historyView.insertBefore(element, this.historyView.childNodes[0]);
		}
		this.filter(this.searchInput.value, [element]);
	}

	filter(filter, elements) {
		elements = (elements || Array.from(this.historyView.childNodes));
		for (var element of elements) {
			element.classList.remove('filtered-out');
		}
		if (filter !== '') {
			for (var element of elements.filter((element) => element.textContent.toLowerCase().indexOf(filter) === -1)) {
				element.classList.add('filtered-out');
			}
		}
	}

}

class Outline {

	constructor() {
		this.view = document.getElementById('outline');
		this.view.controller = this;
		this.elementsView = this.view.getElementsByClassName('elements')[0];
		this.emptyOutline = document.getElementById('empty-outline');
		this.elementsView.removeChild(this.emptyOutline);
		this.view.addEventListener('click', (event) => {
			var target = event.target, newTarget, node;
			if ((newTarget = target.closest('.line'))) {
				var fileref = this.entityMap[newTarget.dataset.entityId];
				editor.open(bookmarks.history[0], {selection: fileref.pos || fileref.index}, room.getClientNameByType(false));
			} else if (this.previewTree && (node = this.previewTree.nodeForView(target)) && node.nodeName !== '#text') {
				newTarget = node.view;
				this.selectPreviewNode(node);
				node.view.classList.toggle('expanded');
			} else {
				return;
			}
			this.selectRow(newTarget);
		});
		room.on('history', (path) => {
			if (this.view.parentNode) {
				ignoreActiveView = true;
				this.open();
			}
		});
		room.on('saved', () => {
			if (this.view.parentNode) {
				ignoreActiveView = true;
				this.open();
			}
		});
		room.on('outlineSelect', (path) => {
			this.selectPreviewNode(path);
		});
	}

	open(outline) {
		if (!outline && bookmarks.history.length > 0) {
			outline = bookmarks.history[0];
		}
		this.elementsView.innerHTML = '';
		this.activeObjects = {topbar: topbar.outlineButton};
		activateView(this.view);
		if (!outline) {
			this.elementsView.appendChild(this.emptyOutline);
		} else if (typeof(outline) === 'string') {
			var doc = fileManager.fileAtPath(outline).doc;
			doc.fetch((error) => {
				if (error) {
					alert(error);
				}
				this.entityMap = {};
				this.nextEntityId = 1;
				this.elementsView.innerHTML = '';
				var extension = Path.extname(outline);
				var content = doc.data.content;
				try {
					if (extension === '.js') {
						outline = this.getJavaScriptOutline(acorn.parse(content));
					} else if (extension === '.html') {
						outline = this.getHTMLOutline(parse5.parse(content, {locationInfo: true}));
					} else if (extension === '.css') {
						outline = this.getCSSOutline(css.parse(content));
					} else {
						throw 'Invalid file type.';
					}
					this.outline = outline;
					this.elementsView.appendChild(this.parseOutline(outline));
				} catch(e) {
					this.elementsView.appendChild(this.emptyOutline);
				}
			});
		} else {
			this.previewTree = new DOMInspector.VDOM(outline, {validateView: (node) => {
				if (node.nodeName === '#text') {
					// hide all text nodes which contain only whitespaces
					if (node.nodeValue.trim().length === 0) {
						node.view.classList.add('hidden');
					}
				} else {
					// hide all nodes with an id starting with "_xde_"
					if (node.id && node.id.startsWith('_xde_')) {
						node.view.classList.add('hidden');
					}
				}
			}});
			this.elementsView.appendChild(this.previewTree.view());
		}
	}

	close() {
		this.elementsView.innerHTML = '';
		delete this.outline;
		delete this.entityMap;
		delete this.nextEntityId;
		delete this.previewTree;
	}

	selectRow(row) {
		if (this.selectedRow) {
			this.selectedRow.classList.remove('selected');
		}
		this.selectedRow = row;
		row.classList.add('selected');
	}

	updatePreviewTree(updates) {
		this.previewTree.ingestUpdates(updates);
	}

	selectPreviewNode(node) {
		var path;
		if (typeof(node) === 'string') {
			path = node;
			node = this.previewTree.nodeAtPath(path);
		} else {
			path = this.previewTree.pathForNode(node);
		}
		this.selectRow(node.view);
		var parent = node.parentNode;
		while (parent) {
			parent.view.classList.add('expanded');
			parent = parent.parentNode;
		}
		for (var clientName of room.getClientNamesByView('preview')) {
			preview.highlightElement(path, clientName);
		}
	}

	getHTMLOutline(token, level = 0) {
		if (Array.isArray(token)) {
			var children = token.map((child) => this.getHTMLOutline(child, level)).filter((element) => element);
			return (children.length > 0 ? children : null);
		} else if (typeof(token) === 'object') {
			var nodeName = token.nodeName;
			if (nodeName === '#document') {
				return this.getHTMLOutline(token.childNodes);
			}
			if (nodeName !== '#text') {
				var outline = {name: nodeName, type: 'htmlTag', level, index: token.__location.startOffset};
				if (token.attrs) {
					outline.params = '';
					for (var attr of token.attrs || []) {
						var symbol = {id: '#', class: '.'}[attr.name];
						if (symbol) {
							outline.params += ' ' + attr.value.split(' ').map((component) => `${symbol}${component}`).join(' ');
						}
					}
				}
				if (token.childNodes) {
					outline.children = this.getHTMLOutline(token.childNodes, level + 1);
				}
				return outline;
			}
		}
		return null;
	}

	getCSSOutline(token, level = 0) {
		if (Array.isArray(token)) {
			var children = token.map((child) => this.getCSSOutline(child, level)).filter((element) => element);
			return (children.length > 0 ? children : null);
		} else if (typeof(token) === 'object') {
			var type = token.type;
			if (type === 'stylesheet') {
				return this.getCSSOutline(token.stylesheet.rules);
			}
			var name, type;
			if (type === 'rule') {
				name = token.selectors.join(', ');
				type = {'#': 'cssId', '.': 'cssClass'}[name[0]] || 'cssTag';
			} else if (['charset', 'viewport', 'import', 'page', 'document', 'media', 'supports'].indexOf(type) !== -1) {
				name = `@${type} ${token[type]}`;
				type = 'cssAt';
			} else {
				return null;
			}
			var pos = token.position.start;
			var outline = {name, type, level, pos: {line: pos.line - 1, ch: pos.column - 1}};
			if (token.rules) {
				outline.children = this.getCSSOutline(token.rules, level + 1);
			}
			return outline;
		}
		return null;
	}

	getJavaScriptOutline(token, level = 0) {
		if (Array.isArray(token)) {
			var children = token.map((child) => this.getJavaScriptOutline(child, level)).filter((element) => element);
			return (children.length > 0 ? children : null);
		} else if (typeof(token) === 'object') {
			var type = token.type;
			if (type === 'Program') {
				return this.getJavaScriptOutline(token.body);
			}
			var name, params, children;
			if (type === 'ClassDeclaration') {
				name = `${token.id.name}`;
				if (token.superClass) {
					params = `: ${token.superClass}`;
				}
				type = 'jsClass';
				children = token.body;
			} else if (type === 'MethodDefinition') {
				name = `${token.key.name}`;
				params = token.value.params.map((param) => param.name);
				params = `(${params.join(', ')})`;
				type = 'jsFunction';
				children = token.value.body;
			} else if (token.type === 'FunctionDeclaration') {
				name = `${token.id.name}`;
				params = token.params.map((param) => param.name);
				params = `(${params.join(', ')})`;
				type = 'jsFunction';
				children = token.body;
			} else {
				return null;
			}
			var outline = {name, params, type, level, index: token.start};
			if (children && (children = this.getJavaScriptOutline(children.body, level + 1))) {
				outline.children = children;
			}
			return outline;
		}
		return null;
	}

	parseOutline(outline) {
		if (Array.isArray(outline)) {
			var children = document.createElement('div');
			for (var elem of outline) {
				elem.parent = outline;
				children.appendChild(this.parseOutline(elem));
			}
			return children;
		}
		var icons = {jsClass: 'user', jsFunction: 'globe', jsPrivate: 'lock', cssTag: 'tag', cssId: 'hashtag', cssClass: 'ellipsis-h', cssAt: 'at'};
		var line = document.createElement('a');
		line.className = `line ${outline.type}`;
		line.innerHTML = '<div class="indent"></div>'.repeat(outline.level) + (icons[outline.type] ? `<span class="fa fa-${icons[outline.type]}"></span>` : '') + outline.name + (outline.params ? `<span class="params">${outline.params}</span>` : '');
		line.dataset.entityId = this.nextEntityId;
		this.entityMap[this.nextEntityId] = outline;
		this.nextEntityId += 1;
		if (outline.children) {
			var container = document.createElement('div');
			container.className = 'expanded';
			container.appendChild(line);
			var children = this.parseOutline(outline.children);
			children.className = 'children';
			container.appendChild(children);
			return container;
		}
		return line;
	}

}

class Settings {

	constructor() {
		this.view = document.getElementById('settings');
		this.view.controller = this;
		this.load();
		room.on('init', (data) => {
			this.values.name = data.name;
			this.values.color = data.color;
		});
		this.nameTextField = document.getElementById('name-setting');
		room.on('clientUpdated', (clientName, key, value) => {
			if (clientName === this.values.name) {
				this.values[key] = value;
				this.save();
				if (key === 'name') {
					if (this.view.parentNode) {
						this.nameTextField.value = value;
					}
				} else if (key === 'hideBars') {
					this.toggleBars(value);
				}
			}
		});
		inputField(this.nameTextField, (newName) => {
			if (newName) {
				room.updateClient(this.values, 'name', newName);
			}
		});
		this.splitSegmentedControl = document.getElementById('split-setting');
		this.splitSegmentedControl.addEventListener('click', (event) => {
			var target = event.target.closest('button');
			if (target) {
				this.split(target.dataset.split);
			}
		});
		this.selectedSplitControlSegment = this.splitSegmentedControl.querySelector('[data-split="no"]')
		this.fullscreenButton = document.getElementById('fullscreen-setting');
		this.fullscreenButton.addEventListener('click', (event) => {
			if (document.webkitFullscreenElement) {
				document.webkitExitFullscreen();
			} else {
				document.documentElement.webkitRequestFullscreen();
			}
		});
		document.addEventListener('webkitfullscreenchange', (event) => {
			this.fullscreenButton.checked = document.webkitFullscreenElement !== null;
		});
		document.addEventListener('webkitfullscreenerror', (event) => {
			alert('Error requesting fullscreen.');
		});
		var resizeHandler = () => {
			if (editor.view.parentNode) {
				editor.codeMirror.setSize('100%', '100%');
			}
		};
		window.addEventListener('resize', resizeHandler);
		var eventNames = (this.values.touch ? {down: 'touchstart', move: 'touchmove', end: 'touchend'} : {down: 'mousedown', move: 'mousemove', end: 'mouseup'});
		document.addEventListener(eventNames.down, (event) => {
			if (event.target.closest('.split-pane-divider')) {
				document.addEventListener(eventNames.move, resizeHandler);
				document.addEventListener(eventNames.end, () => {
					document.removeEventListener(eventNames.move, resizeHandler);
				}, {once: true});
			}
		});

		this.toggleBars(this.values.hideBars);
	}

	getDevice(forceDeviceTypeByName = false) {
		var devices = [{diam: 900, type: 'mobile', touch: true}, {diam: 1500, type: 'tablet', touch: true}, {diam: Number.MAX_VALUE, type: 'tv', touch: true}, {diam: 1500, type: 'laptop', touch: false}, {diam: 2300, type: 'desktop', touch: false}, {diam: Number.MAX_VALUE, type: 'tv', touch: false}];
		var width = window.innerWidth;
		var height = window.innerHeight;
		var diam = Math.sqrt(width * width + height * height);
		var touch = 'ontouchstart' in document.documentElement;
		for (var device of devices) {
			if ((forceDeviceTypeByName && this.values.name ? this.values.name.startsWith(device.type) : diam <= device.diam && touch === device.touch)) {
				return device;
			}
		}
		return null;
	}

	split(split) {
		var top = document.getElementById('top-component'), bottom = document.getElementById('bottom-component');
		var left = document.getElementById('left-component'), right = document.getElementById('right-component');
		if (split === 'v') {
			if (left) {
				return;
			}
			var splitView = document.createElement('div');
			splitView.className = 'split-pane fixed-left';
			splitView.innerHTML = '<div id="left-component" class="split-pane-component"></div><div id="divider-v" class="split-pane-divider"></div><div id="right-component" class="split-pane-component"></div>';
			var [left, right] = splitView.getElementsByClassName('split-pane-component');
			left.appendChild((top ? top.firstChild : mainView.firstElementChild));
			right.appendChild((bottom ? bottom.firstChild : welcome));
			activeContainer = (!top || activeContainer === top ? left : right);
			mainView.innerHTML = '';
			mainView.appendChild(splitView);
			$(splitView).splitPane();
		} else if (split === 'h') {
			if (top) {
				return;
			}
			var splitView = document.createElement('div');
			splitView.className = 'split-pane fixed-top';
			splitView.innerHTML = '<div id="top-component" class="split-pane-component"></div><div id="divider-h" class="split-pane-divider"></div><div id="bottom-component" class="split-pane-component"></div>';
			var [top, bottom] = splitView.getElementsByClassName('split-pane-component');
			top.appendChild((left ? left.firstChild : mainView.firstElementChild));
			bottom.appendChild((right ? right.firstChild : welcome));
			activeContainer = (!left || activeContainer === left ? top : bottom);
			mainView.innerHTML = '';
			mainView.appendChild(splitView);
			$(splitView).splitPane();
		} else if (split === 'no') {
			var activeView = activeContainer.firstChild;
			if (top) {
				top.removeChild(top.firstChild);
				bottom.removeChild(bottom.firstChild);
			} else if (left) {
				left.removeChild(left.firstChild);
				right.removeChild(right.firstChild);
			} else {
				return;
			}
			mainView.innerHTML = '';
			mainView.appendChild(activeView);
			activeContainer = mainView;
		} else {
			return;
		}
		this.selectedSplitControlSegment.classList.remove('active');
		this.selectedSplitControlSegment = this.splitSegmentedControl.querySelector(`[data-split="${split}"]`);
		this.selectedSplitControlSegment.classList.add('active');
	}

	toggleBars(hidden) {
		if (hidden) {
			document.body.classList.add('fullscreen');
		} else {
			document.body.classList.remove('fullscreen');
		}
	}

	load() {
		this.values = JSON.parse(localStorage.getItem('settings')) || {};
		var device = this.getDevice(forceDeviceTypeByName) || this.getDevice(false);
		this.values.deviceType = device.type;
		this.values.touch = device.touch;
		this.values.views = this.values.views || [];
	}

	save() {
		localStorage.setItem('settings', JSON.stringify(this.values));
	}

	open() {
		this.activeObjects = {topbar: topbar.settingsButton};
		activateView(this.view);
		document.getElementById('name-setting').value = this.values.name;
	}

}

class Help {

	constructor() {
		this.view = document.getElementById('help');
		this.view.controller = this;
	}

	open() {
		this.activeObjects = {};
		activateView(this.view);
	}

}

function inputField(textField, callback) {
	var isInput = textField.nodeName === 'INPUT';
	if (!isInput) {
		var range = document.createRange();
		var textNode = textField.lastChild;
		range.setStart(textNode, 0);
		var name = textField.textContent;
		range.setEnd(textNode, Path.basename(name, Path.extname(name)).length);
		var sel = window.getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
	}
	var oldValue, canceled = false;
	textField.addEventListener('focus', (event) => {
		oldValue = event.target.value;
	});
	textField.addEventListener('keydown', (event) => {
		if (event.keyCode === 13) {
			textField.blur();
		} else if (event.keyCode === 27) {
			canceled = true;
			if (isInput) {
				textField.value = oldValue;
			}
			textField.blur();
		}
	});
	textField.addEventListener('blur', (event) => {
		callback((canceled ? null : isInput ? textField.value : textField.textContent));
	});
}
window.inputField = inputField;

function openView(view, container) {
	var oldView = container.lastElementChild;
	if (oldView) {
		if (oldView.controller && oldView.controller.close) {
			oldView.controller.close();
		}
		if (oldView === preview.view) {
			oldView.style.display = 'none';
		} else {
			container.removeChild(oldView);
		}
	}
	if (view.parentNode === container) {
		view.style.display = '';
	} else {
		container.appendChild(view);
	}
	if (view !== oldView) {
		var index;
		if (oldView && (index = settings.values.views.map((view) => view.name).indexOf(oldView.id)) !== -1) {
			settings.values.views.splice(index, 1);
		}
		settings.values.views.splice(0, 0, {name: view.id});
		settings.save();
		room.updateClient(settings.values, 'views', settings.values.views);
	}
	return oldView;
}

function openViewByName(view, args = {}) {
	if (view === 'editor') {
		editor.open(args.path, args.options);
	} else if (view === 'preview') {
		preview.open(args.path);
	} else if (view === 'console') {
		jsConsole.open();
	} else if (view === 'search') {
		search.open();
	} else if (view === 'outline') {
		if (args.updates) {
			outline.updatePreviewTree(args.updates);
		} else {
			outline.open(args.outline);
		}
	} else if (view === 'welcome') {
		activateView('welcome');
	} else if (view === 'settings') {
		settings.open();
	} else if (view === 'help') {
		help.open();
	}
}

var ignoreActiveView = false, temporarySplit = false;
function activateView(view) {
	if (temporarySplit) {
		settings.split('no');
		temporarySplit = false;
	}
	var oldContainer = view.parentNode;
	var oldView = openView(view, (oldContainer && ignoreActiveView ? oldContainer : activeContainer));
	if (!ignoreActiveView) {
		if (oldContainer && oldContainer !== activeContainer) {
			openView(oldView, oldContainer);
		}
		var activeObjects = view.controller.activeObjects;
		topbar.setActiveObject(activeObjects.topbar);
		sidebar.setActiveObject(activeObjects.sidebar);
	}
	ignoreActiveView = false;
}

var activeContainer;
function setActiveContainer(event) {
	var view;
	if (document.activeElement === preview.view) {
		activeContainer = preview.view.parentNode;
		view = preview.view;
	} else if (event.target.closest) {
		var newActiveContainer = event.target.closest('#main, #left-component, #right-component, #top-component, #bottom-component');
		if (newActiveContainer) {
			activeContainer = newActiveContainer;
			view = activeContainer.firstElementChild;
			if (view == preview.view) {
				view = activeContainer.lastElementChild;
			}
		}
	}
	if (view) {
		var activeObjects = view.controller.activeObjects;
		topbar.setActiveObject(activeObjects.topbar);
		sidebar.setActiveObject(activeObjects.sidebar);
	}
}

var connection = new ShareDB.Connection(new WebSocket(`ws://${window.location.hostname}:${ports.sharedb}`));

var fileManager, settings, room, editor, preview, jsConsole, search, bookmarks, outline, help, welcome, topbar, sidebar;
window.onload = (event) => {
	fileManager = new ShareDBFileManager(connection, {verbose: debug});
	fileManager.on('error', (error) => {
		_error(error);
	});
	document.addEventListener('focus', (event) => {
		if (['input', 'textarea'].indexOf(event.target.tagName) !== -1) {
			setActiveContainer(event);
		}
	});
	mainView = document.getElementById('main');
	mainView.addEventListener('click', setActiveContainer, true);
	window.addEventListener('blur', setActiveContainer, true);
	activeContainer = mainView;
	$('.split-pane').splitPane();
	room = new Room();
	settings = new Settings();
	topbar = new Topbar();
	editor = new Editor();
	preview = new Preview();
	jsConsole = new JSConsole();
	search = new Search();
	bookmarks = new Bookmarks();
	outline = new Outline();
	help = new Help();
	welcome = document.getElementById('welcome');
	sidebar = new Sidebar();
	window.sidebar = sidebar;
	document.getElementById('views').innerHTML = '';
	if (settings.values.views) {
		settings.values.views = [];
//		openViewByName(settings.values.views[0].name);
	}
	room.on('openView', (view, args) => { openViewByName(view, args); });

	document.onvisibilitychange = (event) => {
//		room.emit('hidden', document.hidden);
	}
	window.onbeforeunload = (event) => {
		settings.values.expandedDirectories = fileManager.expandedDirectories().map((file) => file.doc.data.path);
		settings.save();
	}
}
