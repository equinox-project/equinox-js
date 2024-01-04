# How to contribute to EquinoxJS

We would love for you to contribute to EquinoxJS and help make it even better
than it is today! As a contributor, here are the guidelines we would like you
to follow:

## <a href="question"></a> Got a question or problem?

**Do not open issues for general support questions. Github issues are reserved
for bug reports and feature requests**. To get your questions answered please
head over to the [DDD-CQRS-ES discord][discord].

## <a href="bug"></a> Found a bug?

If you find a bug in the source code, you can help us by
[submitting an issue](#submit-issue) to our [GitHub Repository][github]. Even better, you can
[submit a Pull Request](#submit-pr) with a fix.

## <a name="feature"></a> Missing a Feature?

You can _request_ a new feature by [submitting an issue](#submit-issue) to our GitHub
Repository. If you would like to _implement_ a new feature, please submit an issue with
a proposal for your work first, to be sure that we can use it.
Please consider what kind of change it is:

- For a **Major Feature**, first open an issue and outline your proposal so
  that it can be discussed. This will also allow us to better coordinate our
  efforts, prevent duplication of work, and help you to craft the change so
  that it is successfully accepted into the project. For your issue name,
  please prefix your proposal with `[discussion]`, for example "[discussion]:
  your feature idea".
- **Small Features** can be crafted and directly [submitted as a Pull
  Request](#submit-pr).

## <a name="submit"></a> Submission Guidelines

### <a name="submit-issue"></a> Submitting an Issue

Before you submit an issue, please search the issue tracker, maybe an issue for
your problem already exists and the discussion might inform you of workarounds
readily available.

We want to fix all the issues as soon as possible, but before fixing a bug we
need to reproduce and confirm it. In order to reproduce bugs we will
systematically ask you to provide a minimal reproduction scenario using a
repository or [Gist](https://gist.github.com/). Having a live, reproducible
scenario gives us wealth of important information without going back & forth to
you with additional questions like:

- version of EquinoxJS used
- 3rd-party libraries and their versions
- and most importantly - a use-case that fails

Unfortunately, we are not able to investigate / fix bugs without a minimal
reproduction, so if we don't hear back from you we are going to close an issue
that doesn't have enough info to be reproduced.

You can file new issues [here][new_issue]

### <a name="submit-pr"></a> Submitting a Pull Request (PR)

Before you submit your Pull Request (PR) consider the following guidelines:

1. Search [GitHub Pull Requests][gh_prs] for an open or closed PR
   that relates to your submission. You don't want to duplicate effort.
1. Fork this repository.
1. Make your changes in a new git branch:

   ```shell
   git checkout -b my-fix-branch main
   ```

1. Create your patch, **including appropriate test cases**.
1. Follow our [Coding Rules](#rules).
1. Run the full test suite (see [common scripts](#common-scripts)),
   and ensure that all tests pass.
1. Commit your changes using a descriptive commit message.

   ```shell
   git commit -a
   ```

   Note: the optional commit `-a` command line option will automatically "add" and "rm" edited files.

1. Push your branch to GitHub:

   ```shell
   git push origin my-fix-branch
   ```

1. In GitHub, send a pull request to `equinox-js:main`.

- If we suggest changes then:

  - Make the required updates.
  - Re-run the test suites to ensure tests are still passing.
  - Rebase your branch and force push to your GitHub repository (this will update your Pull Request):

    ```shell
    git rebase master -i
    git push -f
    ```

That's it! Thank you for your contribution!

## <a name="development"></a> Development Setup

You will need [Node.js](https://nodejs.org) version >= 20.7.0.
You should have [corepack](https://nodejs.org/api/corepack.html) enabled to
ensure you're using the same version of `pnpm` as other contributors, this
avoids large unrelated changes to the lockfile.

1. After cloning the repo, run:

```bash
$ pnpm i
```

2. start the docker-compose services

```bash
$ docker-compose up -d
```

3. Run the tests

```bash
$ pnpm test
```

### <a name="common-scripts"></a>Commonly used NPM scripts

```bash
# build all packages
$ pnpm build

# run the full test suite
$ pnpm test # or vitest run

# run the example application
$ cd ./apps/example
$ pnpm start:http
```

## <a name="rules"></a> Coding Rules

> ### Legal Notice
>
> When contributing to this project, you must agree that you have authored 100%
> of the content, that you have the necessary rights to the content and that
> the content you contribute may be provided under the project license.

[github]: https://github.com/equinox-project/equinox-js
[discord]: https://discord.gg/sEZGSHNNbH
[new_issue]: https://github.com/equinox-project/equinox-js/issues/new
[gh_prs]: https://github.com/equinox-project/equinox-js/pulls
