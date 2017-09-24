var Path = require('path');
var uuid = require('uuid');
var EventEmitter = require('events');

class ShareDBFileManager extends EventEmitter {

	constructor(connection, options = {}) {
		super();
		this.rootFile = {children: [], level: 0};
		this.connection = connection;
		var verbose = Boolean(options.verbose);
		this.log = (...args) => {
			if (verbose) {
				console.debug.apply(console, args);
			}
		};

		var filesQuery = connection.createSubscribeQuery('files');

		filesQuery.on('ready', () => {
			this.log('ShareDB: ready', filesQuery.results);
			var rootFile = this.rootFile;
			rootFile.children.splice(0, rootFile.children.length);
			var view = rootFile.view;
			if (view) {
				delete rootFile.view;
			}
			this.ingestUpdates({insertedDocs: filesQuery.results});
			if (view) {
				rootFile.view = view;
				this.view();
			}
			this.emit('ready');
		});

		filesQuery.on('insert', (docs, atIndex) => {
			this.log('ShareDB: insert', docs);
			this.ingestUpdates({insertedDocs: docs});
		});

		filesQuery.on('remove', (docs, atIndex) => {
			this.log('ShareDB: remove', docs);
			this.ingestUpdates({removedDocs: docs});
		});

		filesQuery.on('error', (error) => {
			this.log('ShareDB: error', error);
			this.emit('error', error);
		});

//        pathsQuery = connection.createSubscribeQuery('paths');
//
//        pathsQuery.on('changed', (results) => {
//            console.log(results);
//            this['callback']();
//        });
	}

	fileAtPath(path, parent) {
		if (path === '.') {
			return this.rootFile;
		}
		if (typeof(path) === 'string') {
			path = path.split('/');
		}
		if (!parent) {
			parent = this.rootFile;
		}
		if (path.length > 0) {
			var name = path[0];
			path.splice(0, 1);
			for (var child of parent.children) {
				if (Path.basename(child.doc.data.path) === name) {
					return this.fileAtPath(path, child);
				}
			}
			return null;
		}
		return parent;
	}

//    removeFileAtPath(path) {
//        var file = this.fileAtPath(path);
//        if (file) {
//            file.parent.children.splice(i, 1);
//            delete file.parent;
//            return file;
//        }
//        return null;
//    }
	_removeDoc(doc, parent) {
		if (!parent) {
			parent = this.rootFile;
		}
		for (var i = 0; i < parent.children.length; i += 1) {
			var child = parent.children[i];
			if (child.doc === doc) {
				parent.children.splice(i, 1);
				delete child.parent;
				return child;
			} else if (child.children) {
				var file = this._removeDoc(doc, child);
				if (file) {
					return file;
				}
			}
		}
		return null;
	}

	ingestUpdates(updates) {
		var rootFile = this.rootFile;
		if (updates.removedDocs) {
			var files = [];
			for (var doc of updates.removedDocs) {
				var file = this._removeDoc(doc);
				files.push(file);
			}
			// update the view
			if (rootFile.view) {
				for (var file of files) {
					file.view.parentNode.removeChild(file.view);
				}
				if (rootFile.children.length === 0) {
					rootFile.view.appendChild(this.emptyRootFile);
				}
			}
			this.emit('remove', files)
		}
		if (updates.insertedDocs) {
			var files = [];
			for (var doc of updates.insertedDocs) {
				var file = {doc};
				if (doc.data.type === 'directory') {
					file.children = [];
				}
				var parent = this.fileAtPath(Path.dirname(file.doc.data.path));
				if (parent) {
					parent.children.push(file);
					parent.children.sort((a, b) => a.doc.data.path.localeCompare(b.doc.data.path));
					file.parent = parent;
					file.level = parent.level + 1;
					files.push(file);
				}
			}
			// update the view
			if (rootFile.view) {
				for (var file of files) {
					var parent = file.parent, siblings = parent.children;
					var children = (parent === rootFile ? parent.view : parent.view.lastChild);
					var index = siblings.indexOf(file);
					if (index < siblings.length - 1) {
						children.insertBefore(this.view(file), siblings[index + 1].view);
					} else {
						children.appendChild(this.view(file));
					}
				}
			}
			this.emit('insert', files);
		}
	}

	baseForNewFile(relative, base) {
		if (!relative || relative === this.rootFile) {
			return base;
		}
		var doc = relative.doc;
		var path = doc.data.path;
		if (doc.data.type !== 'directory') {
			path = Path.dirname(path);
			if (path === '.') {
				path = '';
			}
		}
		return Path.join(path, base);
	}

	createFile(name, relative, callback) {
		var path = this.baseForNewFile(relative, name);
		var newDoc = this.connection.get('files', uuid.v1());
		newDoc.create({type: 'text', path, content: ''}, (error) => {
			if (callback) {
				callback(path, error);
			}
		});
	}

	createDirectory(name, relative, callback) {
		var path = this.baseForNewFile(relative, name);
		var newDoc = this.connection.get('files', uuid.v1());
		newDoc.create({type: 'directory', path}, (error) => {
			if (callback) {
				callback(path, error);
			}
		});
	}

	moveFile(file, newPath, callback) {
		var doc = file.doc;
		var path = doc.data.path;
		if (newPath.startsWith('./')) {
			newPath = newPath.substr(2);
		}
		doc.submitOp([{p: ['path'], t: 'text0', o: [{p: 0, d: path}, {p: 0, i: newPath}]}], (error) => {
			var doc = file.doc;
			this.ingestUpdates({removedDocs: [doc], insertedDocs: [doc]});
			if (callback) {
				callback(error);
			}
		});
	}

	deleteFile(file, callback) {
		var doc = file.doc;
		doc.del(callback);
	}

	_viewIndent(view, level) {
		for (var i = 0; i < level; i += 1) {
			var indent = document.createElement('span');
			indent.classList.add('indent');
			view.insertBefore(indent, view.firstChild);
		}
	}

	view(file) {
		if (!file) {
			file = this.rootFile;
			var view = file.view;
			if (!view) {
				var view = document.createElement('div');
				view.className = 'file';
				view.dataset.fileId = 0;
				file.view = view;
				this.emptyRootFile = document.createElement('a');
				this.emptyRootFile.className = 'disabled';
				this.emptyRootFile.textContent = 'The project is empty.';
			} else {
				view.innerHTML = '';
			}
			this.fileMap = {0: file};
			if (file.children && file.children.length > 0) {
				for (var child of file.children) {
					view.appendChild(this.view(child));
				}
			} else {
				view.appendChild(this.emptyRootFile);
			}
			return view;
		}
		var view, a;
		if (file.children) {
			a = document.createElement('a');
			a.className = 'folder';
			a.innerHTML = `<span class="fa fa-caret-right"></span><span class="name">${Path.basename(file.doc.data.path)}</span>`;
			var subfiles = document.createElement('div');
			subfiles.className = 'subfiles';
			for (var child of file.children) {
				subfiles.appendChild(this.view(child));
			}
			view = document.createElement('div');
			view.appendChild(a);
			view.appendChild(subfiles);
		} else {
			view = a = document.createElement('a');
			view.className = 'regular';
			view.innerHTML = `<span class="name">${Path.basename(file.doc.data.path, Path.extname(file.doc.data.path))}<span class="extension">${Path.extname(file.doc.data.path)}</span></span>`;
			$(view).draggable(window.sidebar.drag);
		}
		this._viewIndent(a, file.level - 1);
		view.classList.add('file');
		view.dataset.fileId = file.doc.id;
		this.fileMap[file.doc.id] = file;
		file.view = view;
		return view;
	}

	fileForView(view) {
		while (!view.classList || !view.classList.contains('file')) {
			if (view.parentNode) {
				view = view.parentNode;
			} else {
				return null;
			}
		}
		return this.fileMap[view.dataset.fileId];
	}

	toggleDirectory(file, open, ancestors) {
		if (typeof(file) === 'string') {
			file = this.fileAtPath(file);
		}
		if (!file || file === this.rootFile) {
			return;
		}
		var caret = file.view.firstChild.getElementsByClassName('fa')[0];
		var children = file.view.lastChild;
		if (open === undefined) {
			open = !children.classList.contains('expanded');
		}
		if (open) {
			children.classList.add('expanded');
			caret.className = 'fa fa-caret-down';
		} else {
			children.classList.remove('expanded');
			caret.className = 'fa fa-caret-right';
		}
		if (open && ancestors && file.parent) {
			this.toggleDirectory(file.parent, open, ancestors);
		}
	}

	expandedDirectories() {
		return Array.from(this.rootFile.view.getElementsByClassName('subfiles expanded')).map((element) => this.fileForView(element));
	}

	_addTempFile(file, view, callback) {
		if (file.children) {
			this._viewIndent(view, file.level);
			this.toggleDirectory(file, true, true);
			if (file === this.rootFile) {
				file.view.appendChild(view);
			} else {
				var children = file.view.lastChild;
				children.insertBefore(view, children.childNodes[0]);
			}
		} else {
			this._viewIndent(view, file.level - 1);
			file.view.parentNode.insertBefore(view, file.view);
		}
		var nameNode = view.lastChild;
		nameNode.setAttribute('contenteditable', true);
		nameNode.classList.add('renaming');
		nameNode.focus();
		window.inputField(nameNode, (name) => {
			view.parentNode.removeChild(view);
			if (!name) {
				return;
			}
			callback(name);
		});
	}

	createFileInteractive(file, callback) {
		var view = document.createElement('a');
		view.className = 'file regular';
		view.innerHTML = '<span class="name">newFile</span>';
		this._addTempFile(file, view, (name) => {
			this.createFile(name, file, callback);
		});
	}

	createFolderInteractive(file, callback) {
		var view = document.createElement('a');
		view.className = 'file folder';
		view.innerHTML = '<span class="fa fa-caret-right"></span><span class="name">newFolder</span>';
		this._addTempFile(file, view, (name) => {
			this.createDirectory(name, file, callback);
		});
	}

	moveFileInteractive(file, callback) {
		var doc = file.doc;
		var path = doc.data.path;
		var name = Path.basename(path);
		var nameNode = (file.children ? file.view.firstChild : file.view).lastChild;
		var oldContents = nameNode.childNodes;
		nameNode.setAttribute('contenteditable', true);
		nameNode.classList.add('renaming');
		nameNode.textContent = name;
		nameNode.focus();
		window.inputField(nameNode, (newName) => {
			nameNode.setAttribute('contenteditable', false);
			nameNode.classList.remove('renaming');
			nameNode.innerHTML = '';
			for (var oldContent of oldContents) {
				nameNode.appendChild(oldContent);
			}
			if (!newName || newName === name) {
				return;
			}
			var newPath = Path.join(Path.dirname(path), newName);
			this.moveFile(file, newPath, callback);
		});
	}

}
module.exports = ShareDBFileManager;
