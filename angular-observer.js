angular.module('angular-observer', [])
.provider('$observeProvider', function() {
	/**
	* The observers to update on a call to $observerProvider.checkAll
	* @var {array}
	*/
	this.observers = [];

	/**
	* Add an observer to the stack so it gets updated with a call to $observeProvider.checkAll
	* @param {Object} observer An $observe instance
	*/
	this.register = observer => this.observers.push(observer);

	/**
	* Fire all registered observer check() functions
	*/
	this.checkAll = _=> this.observers.forEach(observer => observer.check());

	this.$get = function() {
		return this;
	};
})
.factory('$observe', function($observeProvider, $timeout) {
	var $observe = function(scope, path) {
		var observe = this;
		observe.scope = scope;
		observe.path = path;
		observe.originalValues = {};


		/**
		* Get the current value of the watch item
		* @param {string|array} path Additional path to append onto the default
		* @return {mixed} The current watch item
		*/
		observe.get = function(path) {
			return _.get(observe.scope, observe.path + (path ? _.isArray(path) ? '.' + path.join('.') : '.' + path : ''));
		};


		/**
		* Walk every item in the tree running a callback on each
		* @param {function} cb The callback to run. This is excuted with (value, key, path) where path is an array of all path segments of that item
		* @param {mixed} [item] A specific item to start at
		* @param {array} [path] If item is specified this is the path segement to pass to the callback
		*/
		observe.traverse = function(cb, item, path) {
			if (_.isUndefined(item) && !path) { // If we we're passed undefined assume the user wanted to just use observe.get()
				return observe.traverse(cb, observe.get(), '', []);
			} else if (_.isArray(item)) {
				item.forEach((v, k) => observe.traverse(cb, v, (path||[]).concat([k])));
			} else if (_.isObject(item)) {
				_.keys(item).forEach((k) => observe.traverse(cb, item[k], (path||[]).concat([k])));
			} else {
				cb(item, path ? path[path.length-1] : '', path||[]);
			}
		};


		/**
		* Inject methods into the object to track for changes
		* @return {Object} This chainable object
		*/
		observe.inject = function() {
			observe.originalValues = {};
			observe.traverse(function(v, k, path) {
				// If its an object (or array) glue the `$clean` property to it to detect writes
				if (_.isObject(v)) {
					Object.defineProperty(v, '$clean', {
						enumerable: false,
						value: true,
					});
				} else if (!_.isPlainObject(v)) { // For everything else - stash the original value in this.parent.$originalValues
					observe.originalValues[path.join('.')] = v;
				}
			});
			return observe;
		};


		/**
		* Check if a path or the entire object is modified
		* @param {string|array} [path] An optional path to examine. If no path is given the entire object is examined and an array of all modified paths is returned
		* @return {array|boolean} If no path was given an array is returned with all modified paths, if a specific path is given a boolean is returned if that path was modified
		*/
		observe.isModified = function(path) {
			if (path) {
				var v = observe.get(path);
				if (_.isObject(v)) { // If its an object (or an array) examine the $clean propertly
					return !v.$clean;
				} else { // If its everything else look at the original value we have on file
					return observe.originalValues[_.isArray(path) ? path.join('.') : path] != v;
				}
			} else {
				var modified = [];
				observe.traverse(function(v, key, path) {
					if (!path.length) {
						// Root node - do nothing
					} else if (observe.isModified(path)) {
						modified.push(path.join('.'));
					}
				});
				return modified;
			}
		};


		/**
		* Check the status of an object and fire all events if any change is found
		* @emits change Fired if any part of the target was changed. Params (value)
		* @emits key Fired if a top level key changes. Params (key, value)
		* @emits path Fired if any item changes. Params (path, value)
		* @emits postChange Fired after all other hooks have fired (and there was at least one change)
		* @emits postInject Fired after the injection stage. Params (value)
		* @return {Object} This chainable object
		*/
		observe.check = function() {
			var modified = observe.isModified();
			if (modified.length) observe.emit('change', observe.get());

			modified.forEach(path => {
				var pathSplit = path.split('.');
				if (pathSplit.length == 1) observe.emit('key', pathSplit[0], observe.get(path));
				observe.emit('path', path, observe.get(path));
			});

			if (modified.length) observe.emit('postChange', observe.get());

			observe.inject();
			if (modified.length) observe.emit('postInject', observe.get());

			return observe;
		};


		/**
		* Alias to run $observerProvider.checkAll
		* This effectively refreshes ALL registered $observe instances
		*/
		observe.checkAll = $observeProvider.checkAll;


		// Events / Hooks {{{
		observe.hooks = {}; // Each key is a hook, each value an array of hook registers. Each register is of type {[id], cb, [once=false]}

		/**
		* Fire a given hook
		* @param {string} hook The hook name
		* @param {mixed...} param Additional parameters to pass to the hook callback
		*/
		observe.emit = function(hook) {
			if (!observe.hooks[hook]) return; // No hook registered
			if (!observe.hooks[hook].length) return; // No-one is interested

			var args = Array.prototype.slice.call(arguments, 0);
			var hook = args.shift();

			observe.hooks[hook].forEach(hook => {
				hook.cb.apply(observe, args);
				if (hook.once) {
					console.log('REMOVE HOOK AFTER ONCE!');
				}
			});

			return observe;
		};


		/**
		* Register a hook
		* @param {string} hook The hook to listen for
		* @param {function} cb The callback when the hook fires
		* @param {Object} [params] Additional hook parameters such as an id
		* @return {Object} This chainable object
		*/
		observe.on = function(hook, cb, params) {
			// Never seen this type of hook before
			if (!observe.hooks[hook]) observe.hooks[hook] = [];

			// Push our hook onto the stack
			observe.hooks[hook].push(Object.assign({}, {
				cb: cb,
				once: false,
			}, params || {}))

			return observe;
		};


		/**
		* Register a hook to fire only once
		* This is really just a conveience function to map on()
		* @param {string} hook The hook to listen for
		* @param {function} cb The callback when the hook fires
		* @param {Object} [params] Additional hook parameters such as an id
		* @return {Object} This chainable object
		* @see on()
		*/
		observe.once = function(hook, cb, params) {
			return observe.on(hook, cb, Object.assign({}, {once: true}, params || {}));
		};


		/**
		* Alias of observe.once
		* @alias once()
		*/
		observe.one = observe.once;


		/**
		* Deregister a hook
		* You can either pass a function (the callback to search for) or a string (the ID to search for)
		* @param {string} hook The hook to deregister
		* @param {function|string} cb Either the callback or the ID of the hook to deregister
		* @return {Object} This chainable object
		*/
		observe.off = function(hook, cb) {
			if (!observe.hooks[hook]) return; // None of this type registered anyway
			observe.hooks[hook] = observe.filter(h => {
				if (_.isFunction(cb)) {
					return h.cb == cb;
				} else {
					return h.id == cb;
				}
			});
			return observe;
		};
		// }}}

		$observeProvider.register(observe);
		$timeout(_=> observe.emit('init')); // Fire init on the next cycle so everything has the chance to register
		return observe;
	};

	$observe.checkAll = $observeProvider.checkAll;
	return $observe;
});
