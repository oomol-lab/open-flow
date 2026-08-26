# Open Flow

Open Flow defines portable workflow semantics, Control API conformance, and shared Browser runtime.
Hosted deployments and Server provide independent implementations for the same product contracts.
The public Open Flow repository is the only editable source of these contracts, conformance assets,
deterministic runtime semantics, and the product-neutral Workbench runtime. Private deployments
consume versioned package artifacts and must not keep synchronized source copies.

> [!IMPORTANT]
> Open Flow is under active development and has not reached its first public release.

Install the package from npm:

```bash
bun add @oomol-lab/open-flow
```

Hosts embed the Workbench runtime and styles from the same versioned artifact:

```ts
import { OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'
import '@oomol-lab/open-flow/workbench.css'
```

Deployment chrome that needs the same light and dark semantic palette without the Workbench styles
can import `@oomol-lab/open-flow/theme.css` and apply `open-flow-theme` plus `data-theme` to its root.

Open Flow clients operate Projects through one selected Control API deployment and do not create,
scan or execute local workflow directories. The concrete Isolated VM host belongs to Server and
is not exported by this package.

[Read the repository documentation](../../docs/README.md).

## License

[Apache-2.0](LICENSE)
