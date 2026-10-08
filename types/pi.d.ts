interface PiWorkspace {
  path?: string;
}

interface PiToolRegistration {
  name: string;
  description: string;
  risk: string;
  schema: Record<string, unknown>;
  execute?: (args: any) => any;
}

interface PiCommandRegistration {
  id: string;
  title: string;
  keywords?: string[];
  run: () => unknown;
}

declare var pi: {
  app?: { getLocale(): Promise<string> };
  desktop?: {
    listOperations(): Promise<Array<{ id: string; description: string; risk: 'read' | 'write' | 'dangerous' }>>;
    invoke(input: { operation: string; args?: unknown[]; confirm?: boolean }): Promise<unknown>;
  };
  workspace: {
    get(): Promise<PiWorkspace>;
  };
  agent: {
    registerTool(tool: PiToolRegistration): Promise<void>;
    unregisterTool(name: string): Promise<void>;
  };
  commands: {
    register(command: PiCommandRegistration): Promise<void>;
    unregister(id: string): Promise<void>;
  };
  ui: {
    openPanel(options: { title: string }): unknown;
  };
};
