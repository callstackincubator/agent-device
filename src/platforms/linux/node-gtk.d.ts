declare module 'node-gtk' {
  /** Load a GObject Introspection namespace. */
  function require(namespace: string, version?: string): any;
  /** Start the GLib main loop integration. */
  function startLoop(): void;
}
