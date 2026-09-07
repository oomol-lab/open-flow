# Designer Lab

Run the local-only Designer component playground from the repository root:

```bash
bun run dev:designer
```

The default **Cards · Content & records** gallery uses the production card, execution status and record controls. It compares compact identity-only cards, plain text summaries and framed report previews, alongside schedule, condition, approval, running and failed examples. Empty content creates no placeholder. Execution status appears once in the footer; lightweight record actions open sample results and logs. Preview surfaces are distinct from the card shell in both themes.

**Workflow components** shows the single execution canvas with a bottom command dock and a sidebar for the selected node. It includes Task, Trigger, Condition, Value, Subflow and Comment nodes, grouped inputs and Variable bindings. **Reset samples** restores the sample layout and selection.

The **Theme Preview** group also contains:

- **Node states**: idle, selected, waiting, running, success and error nodes together.
- **Node controls**: compact inputs, switches, checkboxes, ranges, selects, dates, buttons and popups.
- **Workbench controls**: shared buttons, inputs, choices, badges and feedback in the product theme.
- **Theme palette**: Designer and product color tokens side by side, using the actual CSS variables.

Switch light/dark mode in the toolbar to review both themes. Story URLs are shareable locally with `?story=canvas-cards`, `?story=workflow`, `?story=node-states`, `?story=node-controls`, `?story=product-controls` or `?story=palette`. Sample content stays in English; the language picker changes the actual components' translations.

Designer colors live in `src/designer/browser/styles/light.module.scss` and `dark.module.scss`; product colors live in `src/ui/browser/theme.css`. Edits to these files update the previews through Vite.

Add layered card examples to `cards.tsx`, individual component scenarios to `stories.tsx`, component overviews to `overview.tsx`, and full graph samples to `workflow.tsx`. Keep scenarios deterministic and use the action logger instead of external services. Component stories render inside a real flow node so canvas scaling and popup placement use the same context as Designer. Standalone stories provide their own layout; workflow samples use `FlowDesignerView` and log authoring actions without saving or running a Flow. The Lab is a development tool and has no production build or package entry.
