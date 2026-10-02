interface PluginBridgeResponse<T = unknown> {
  ok?: boolean;
  result?: T;
  error?: string;
}

interface PluginBridge {
  invoke(channel: string, payload?: unknown): Promise<PluginBridgeResponse>;
  on?(event: string, callback: (value?: unknown) => void): void;
}

interface Window {
  pluginBridge?: PluginBridge;
}
