// Model a userscript manager's window wrapper without changing MessageEvent.source.
// This is a regression fixture, not a replacement for testing Tampermonkey itself.
module.exports = function wrappedWindow(source) {
  return `(function(window) {\n${source}\n})(new Proxy(window, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return ['addEventListener', 'removeEventListener', 'postMessage'].includes(key)
        ? value.bind(target) : value;
    }
  }));`
}
