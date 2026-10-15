# Changesets

Every pull request that changes what users get (a feature, a fix, a deliberate API change) adds a changeset:

```sh
pnpm changeset
```

Pick the bump (patch, minor or major) and write one line for the changelog. The file lands in this folder and is committed with the pull request.
The Releasing section of the [contributing guide](https://benjigir.github.io/fx-audio/contributing) explains how a release is cut.
