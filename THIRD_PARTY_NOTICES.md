# Third-party notices

WorkOnIt includes open-source dependencies. Exact resolved versions appear in
`package-lock.json` and `src-tauri/Cargo.lock`; their license texts are shipped
by their respective packages and source distributions.

Notable user-interface dependencies:

| Component         | License           | Source                       |
| ----------------- | ----------------- | ---------------------------- |
| Material Symbols  | Apache-2.0        | `@material-symbols/font-400` |
| Lucide            | ISC               | `lucide-react`               |
| Radix UI          | MIT               | `@radix-ui/react-dialog`     |
| React             | MIT               | `react`, `react-dom`         |
| Tauri             | Apache-2.0 OR MIT | `@tauri-apps/*`, Rust crates |
| caniuse-lite data | CC-BY-4.0         | `caniuse-lite`               |

Application icons and favicon are part of WorkOnIt and distributed under the
project's Apache-2.0 license.

Before publishing a release, maintainers must review both lockfiles and the
automated dependency audit for new licenses or attribution requirements.
