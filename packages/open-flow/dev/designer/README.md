# Designer Lab

Run the local-only Designer component playground from the repository root:

```bash
bun run dev:designer
```

The default **Workflow components** overview includes Task, Trigger, Condition, Value, Subflow and Comment nodes, grouped inputs, Variable bindings and connections. Use the canvas controls to zoom, fit the graph and switch between detail and overview. **Reset samples** restores the sample layout and selection.

The **Theme Preview** group also contains:

- **Node states**: idle, selected, waiting, running, success and error nodes together.
- **Node controls**: compact inputs, switches, checkboxes, ranges, selects, dates, buttons and popups.
- **Workbench controls**: shared buttons, inputs, choices, badges and feedback in the product theme.
- **Theme palette**: Designer and product color tokens side by side, using the actual CSS variables.

Switch light/dark mode in the toolbar to review both themes. Story URLs are shareable locally with `?story=workflow`, `?story=node-states`, `?story=node-controls`, `?story=product-controls` or `?story=palette`. Sample content stays in English; the language picker changes the actual components' translations.

Designer colors live in `src/designer/browser/styles/light.module.scss` and `dark.module.scss`; product colors live in `src/ui/browser/theme.css`. Edits to these files update the previews through Vite.

Add individual component scenarios to `stories.tsx`, component overviews to `overview.tsx`, and full graph samples to `workflow.tsx`. Keep scenarios deterministic and use the action logger instead of external services. Component stories render inside a real flow node so canvas scaling and popup placement use the same context as Designer. Standalone stories provide their own layout; workflow samples use `FlowDesignerView` and log authoring actions without saving or running a Flow. The Lab is a development tool and has no production build or package entry.
