# UI sources

The detail sheet and context menu in `renderer/views.css` adapt the surface, spacing and focus-state recipes from [shadcn/ui](https://github.com/shadcn-ui/ui):

- [Sheet](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/sheet.tsx)
- [Context Menu](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/context-menu.tsx)

This plugin uses native HTML, TypeScript and a nonmodal `<dialog>`. It does not bundle the React/Radix components. Object actions, confirmation, keyboard handling and write safeguards are implemented locally. Keyboard menus open instantly; reduced-motion and high-contrast modes are supported.

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
