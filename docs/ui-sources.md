# UI sources

The context menu and some detail-surface spacing in `renderer/views.css` adapt recipes from [shadcn/ui](https://github.com/shadcn-ui/ui). The work-item detail surface is now a centered modal, not an edge sheet:

- [Sheet](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/sheet.tsx)
- [Context Menu](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/context-menu.tsx)

This plugin uses native HTML, TypeScript and a modal `<dialog>` for item details. It does not bundle the React/Radix components. Board layout does not change when details open. Object actions, confirmation, keyboard handling and write safeguards are implemented locally. Keyboard menus open instantly; reduced-motion and high-contrast modes are supported.

## shadcn/ui license

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Git history graph (0.8.4)

- [Gitgraph.js branch ordering](https://github.com/nicoespeon/gitgraph.js/blob/ed72d11d1e50ccd208326d9ded551f719cfa2b3a/packages/gitgraph-core/src/branches-order.ts), MIT: reference for an explicit preferred-branch order and consistent branch colors; its SVG hover approach was inspected too.
- [VS Code Git Graph](https://github.com/mhutchie/vscode-git-graph/blob/d7f43f429a9e024e896bac9fc65fdc530935c812/web/graph.ts), MIT: reference for parent-derived lanes and colored branch paths.
- Inspected GitHub source and license metadata at the pinned commits. This implementation borrows concepts, not copied code or assets; neither library is bundled. No new dependencies, remote resources, or React/VS Code runtime.
- Local graph uses real commit parents and a snapshot-bound first-parent main axis; nodes reveal safe text on hover/focus and open a native modal on activation. The main axis stays centered; no history or branch names are invented.
