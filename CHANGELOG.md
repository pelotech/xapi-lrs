# Changelog

## [0.8.2](https://github.com/pelotech/xapi-lrs/compare/0.8.1...0.8.2) (2026-07-17)


### Bug Fixes

* **deps:** update dependency @electric-sql/pglite to ^0.5.0 ([#108](https://github.com/pelotech/xapi-lrs/issues/108)) ([323b8ec](https://github.com/pelotech/xapi-lrs/commit/323b8ec4b38c8d71a505b213d94011f9e0d990e5))


### Chores

* **deps:** update actions/checkout action to v7 ([#109](https://github.com/pelotech/xapi-lrs/issues/109)) ([ab8485c](https://github.com/pelotech/xapi-lrs/commit/ab8485ca4334a336a40cc1663009f46a401bcfc3))
* **deps:** update actions/setup-node action to v7 ([#110](https://github.com/pelotech/xapi-lrs/issues/110)) ([e566dee](https://github.com/pelotech/xapi-lrs/commit/e566dee5bd262948bcfbc670a556e9ab88bb7769))
* **deps:** update all npm patch dependencies ([#101](https://github.com/pelotech/xapi-lrs/issues/101)) ([5f87a81](https://github.com/pelotech/xapi-lrs/commit/5f87a817b29af3d1c2a79425598e74d44f740257))
* **deps:** update dependency @hono/zod-openapi to v1.5.1 ([#102](https://github.com/pelotech/xapi-lrs/issues/102)) ([e551e47](https://github.com/pelotech/xapi-lrs/commit/e551e47f7c41db88979b972d3d34f0c840520602))
* **deps:** update dependency dependency-cruiser to v18 ([#111](https://github.com/pelotech/xapi-lrs/issues/111)) ([607b6db](https://github.com/pelotech/xapi-lrs/commit/607b6db4458be0d6260d4ed0a8cf6d2d0abf28f9))
* **deps:** update dependency oxfmt to ^0.59.0 ([#103](https://github.com/pelotech/xapi-lrs/issues/103)) ([db4fec2](https://github.com/pelotech/xapi-lrs/commit/db4fec2677f9550044cc314af65fbe4edd46c7f6))
* **deps:** update dependency oxlint to v1.74.0 ([#104](https://github.com/pelotech/xapi-lrs/issues/104)) ([90d521d](https://github.com/pelotech/xapi-lrs/commit/90d521d878188edbe425278e2a106d00b022b615))
* **deps:** update dependency tsx to v4.23.1 ([#105](https://github.com/pelotech/xapi-lrs/issues/105)) ([2198b27](https://github.com/pelotech/xapi-lrs/commit/2198b271255670c8e9bc4bcd5f16ec50f97a0c60))
* **deps:** update node.js to v24.18.0 ([#106](https://github.com/pelotech/xapi-lrs/issues/106)) ([9ae76c7](https://github.com/pelotech/xapi-lrs/commit/9ae76c75a35084dd5a4526c8ccb809f021586a50))
* **deps:** update pnpm to v10.34.4 ([#107](https://github.com/pelotech/xapi-lrs/issues/107)) ([1138769](https://github.com/pelotech/xapi-lrs/commit/11387691023ca9f90b8783c71a5fba21d9be5369))

## [0.8.1](https://github.com/pelotech/xapi-lrs/compare/0.8.0...0.8.1) (2026-07-17)


### Chores

* **deps:** update actions/attest-build-provenance action to v4.1.1 ([#92](https://github.com/pelotech/xapi-lrs/issues/92)) ([68ce218](https://github.com/pelotech/xapi-lrs/commit/68ce218f9f5827dd3881a8bbf93c9af2bfc59d0f))
* **deps:** update dependency @hono/node-server to v2.0.8 ([#94](https://github.com/pelotech/xapi-lrs/issues/94)) ([4ef9b13](https://github.com/pelotech/xapi-lrs/commit/4ef9b13ef4c4f0fa8aad7fd475ee0fd8e8af322f))
* **deps:** update dependency @hono/zod-openapi to v1.4.0 ([#93](https://github.com/pelotech/xapi-lrs/issues/93)) ([e46e3bc](https://github.com/pelotech/xapi-lrs/commit/e46e3bc7fd7367f9b23f1648878ddd758bf2f2ca))
* **deps:** update dependency @types/node to v24.13.2 ([#95](https://github.com/pelotech/xapi-lrs/issues/95)) ([0d09079](https://github.com/pelotech/xapi-lrs/commit/0d090799d6affc342645ce44bfe0839d935ff32b))
* **deps:** update dependency pg to v8.22.0 ([#96](https://github.com/pelotech/xapi-lrs/issues/96)) ([2e7f0b5](https://github.com/pelotech/xapi-lrs/commit/2e7f0b50b3b9fdc9b46065f3c35c39fe216f2511))
* **deps:** update dependency tsx to v4.22.5 ([#99](https://github.com/pelotech/xapi-lrs/issues/99)) ([babac11](https://github.com/pelotech/xapi-lrs/commit/babac1106665ec6ac142722e4f36b59ae58e7f1c))
* **deps:** update docker/setup-buildx-action digest to bb05f3f ([#91](https://github.com/pelotech/xapi-lrs/issues/91)) ([57cfa94](https://github.com/pelotech/xapi-lrs/commit/57cfa9400edf48f85705f6af9a83c44badcd5711))
* **deps:** update node.js to v24.17.0 ([#100](https://github.com/pelotech/xapi-lrs/issues/100)) ([a00c5b1](https://github.com/pelotech/xapi-lrs/commit/a00c5b13826c84ab8f178ac638803179b5dddaef))


### Tests

* cover /xapi/stream SSE endpoint under the tracing middleware ([#97](https://github.com/pelotech/xapi-lrs/issues/97)) ([fb9b09c](https://github.com/pelotech/xapi-lrs/commit/fb9b09ca7c2cc49dcc5571130fad26d313445f24))

## [0.8.0](https://github.com/pelotech/xapi-lrs/compare/0.7.1...0.8.0) (2026-07-16)


### Features

* OpenTelemetry distributed tracing (OTLP, xAPI data plane) ([#81](https://github.com/pelotech/xapi-lrs/issues/81)) ([447fe74](https://github.com/pelotech/xapi-lrs/commit/447fe744ecf727c229e91be7735edfefc69f8d14))


### Bug Fixes

* ignore non-numeric port env vars (k8s service-link collision) ([#89](https://github.com/pelotech/xapi-lrs/issues/89)) ([4923126](https://github.com/pelotech/xapi-lrs/commit/49231262cf5276c36f1ff0044c836eda259e187f))


### Chores

* adopt stable TypeScript 7 native compiler; drop native-preview ([#88](https://github.com/pelotech/xapi-lrs/issues/88)) ([e441b8c](https://github.com/pelotech/xapi-lrs/commit/e441b8c2878b30f4b19a893ecd2bdccdf043b394))
* **deps:** update actions/checkout digest to df4cb1c ([#84](https://github.com/pelotech/xapi-lrs/issues/84)) ([f747ba4](https://github.com/pelotech/xapi-lrs/commit/f747ba4a24c47f4362bb80a21f014332157e8610))
* **deps:** update actions/setup-node digest to 2499707 ([#86](https://github.com/pelotech/xapi-lrs/issues/86)) ([8b3367a](https://github.com/pelotech/xapi-lrs/commit/8b3367a488fbfce4b78b9cda766e4d80f992c16b))
* **deps:** update all npm patch dependencies ([#64](https://github.com/pelotech/xapi-lrs/issues/64)) ([3dde5c6](https://github.com/pelotech/xapi-lrs/commit/3dde5c6104e7571d012d55eac098a53d17d0c684))
* **deps:** update dependency oxlint to v1.72.0 ([#66](https://github.com/pelotech/xapi-lrs/issues/66)) ([919c458](https://github.com/pelotech/xapi-lrs/commit/919c458f755aa33e694fd0e853aab08593485adc))
* **deps:** update docker/build-push-action digest to 53b7df9 ([#68](https://github.com/pelotech/xapi-lrs/issues/68)) ([293064c](https://github.com/pelotech/xapi-lrs/commit/293064c229361173eb2f043a72e30cfb2f58e310))
* **deps:** update docker/login-action digest to af1e73f ([#69](https://github.com/pelotech/xapi-lrs/issues/69)) ([a32cf56](https://github.com/pelotech/xapi-lrs/commit/a32cf56f3a58c5f16cc3fa8f3b9ff41d1d95a6a7))
* **deps:** update docker/metadata-action digest to dc80280 ([#70](https://github.com/pelotech/xapi-lrs/issues/70)) ([4e908c5](https://github.com/pelotech/xapi-lrs/commit/4e908c55cc7d25d96a8c333e73d6c0e14ad79ef4))
* **deps:** update oxfmt to ^0.57.0; exclude vendored assets from formatting ([#85](https://github.com/pelotech/xapi-lrs/issues/85)) ([6521481](https://github.com/pelotech/xapi-lrs/commit/652148106c56ac3da05facfde27e77f238e87dc7))
* **deps:** update pnpm/action-setup digest to 0ebf471 ([#44](https://github.com/pelotech/xapi-lrs/issues/44)) ([ddc349f](https://github.com/pelotech/xapi-lrs/commit/ddc349f9a68ed38a6c935fbcbbf633426f5bebf3))
* gitignore .claude/ local agent workspace ([#78](https://github.com/pelotech/xapi-lrs/issues/78)) ([509d3e1](https://github.com/pelotech/xapi-lrs/commit/509d3e14fa29a5217d68fa6aa7d5639be9c325ce))

## [0.7.1](https://github.com/pelotech/xapi-lrs/compare/v0.7.0...0.7.1) (2026-07-15)


### Chores

* publish release version and image tags without the v prefix ([#79](https://github.com/pelotech/xapi-lrs/issues/79)) ([ec47d37](https://github.com/pelotech/xapi-lrs/commit/ec47d3725e697bc00d8fed53c787a388d7f9a582))

## [0.7.0](https://github.com/pelotech/xapi-lrs/compare/v0.6.0...v0.7.0) (2026-07-15)


### Features

* adopt XAPI_LRS_ env var prefix; deprecate LRSQL_ and LRS_ aliases ([#59](https://github.com/pelotech/xapi-lrs/issues/59)) ([9ec5cd2](https://github.com/pelotech/xapi-lrs/commit/9ec5cd2cc018ef601d92cf8dd01a1bf6ea11fb4d))


### Chores

* attest SBOMs to registry instead of uploading to immutable releases ([#76](https://github.com/pelotech/xapi-lrs/issues/76)) ([5e770c4](https://github.com/pelotech/xapi-lrs/commit/5e770c4a53e6471b052cbe91668b4b479d7fd00b))

## [0.6.0](https://github.com/pelotech/xapi-lrs/compare/v0.5.2...v0.6.0) (2026-07-15)


### ⚠ BREAKING CHANGES

* adopt lrsql v0.9.5 schema and support lrsql takeover ([#72](https://github.com/pelotech/xapi-lrs/issues/72))

### Features

* adopt lrsql v0.9.5 schema and support lrsql takeover ([#72](https://github.com/pelotech/xapi-lrs/issues/72)) ([882384e](https://github.com/pelotech/xapi-lrs/commit/882384edaa462167b7acc7c6bd367c309e841ad2))
* xAPI 2.0 server conformance ([#73](https://github.com/pelotech/xapi-lrs/issues/73)) ([c4ca9af](https://github.com/pelotech/xapi-lrs/commit/c4ca9af1435278bf20fa68915caf5f8443473e27))

## [0.5.2](https://github.com/pelotech/xapi-lrs/compare/v0.5.1...v0.5.2) (2026-07-15)


### Bug Fixes

* reject -00:00 timestamp offsets; run official ADL suite for xAPI 1.0.3 and 2.0 ([#71](https://github.com/pelotech/xapi-lrs/issues/71)) ([497839a](https://github.com/pelotech/xapi-lrs/commit/497839ac83e96de78b015fff908e5928f907889f))

## [0.5.1](https://github.com/pelotech/xapi-lrs/compare/v0.5.0...v0.5.1) (2026-05-14)


### Bug Fixes

* add `?api_key=` filter to `GET /api/admin/credentials` ([#62](https://github.com/pelotech/xapi-lrs/issues/62)) ([8c6dcd6](https://github.com/pelotech/xapi-lrs/commit/8c6dcd6c58a36e678d8caf33a5a8bc0fb74fec58))

## [0.5.0](https://github.com/pelotech/xapi-lrs/compare/v0.4.0...v0.5.0) (2026-05-13)


### Features

* add `GET /api/admin/credentials/:id` for single-credential lookup ([#60](https://github.com/pelotech/xapi-lrs/issues/60)) ([d91a58b](https://github.com/pelotech/xapi-lrs/commit/d91a58b4e1def0be6d3722acb835fa1952302781))

## [0.4.0](https://github.com/pelotech/xapi-lrs/compare/v0.3.2...v0.4.0) (2026-05-13)


### Features

* graceful shutdown and split k8s probes ([#56](https://github.com/pelotech/xapi-lrs/issues/56)) ([141f465](https://github.com/pelotech/xapi-lrs/commit/141f4650668652302b74305cdfa00762ffb26377))
* tighten admin CSP + enforce DB `statement_timeout` ([#55](https://github.com/pelotech/xapi-lrs/issues/55)) ([cf7e608](https://github.com/pelotech/xapi-lrs/commit/cf7e608684094203976d8fb2389342ced550e7b7))


### Chores

* align request logging with OpenTelemetry HTTP semconv ([#54](https://github.com/pelotech/xapi-lrs/issues/54)) ([8fecb12](https://github.com/pelotech/xapi-lrs/commit/8fecb1291434b5cc0583e97eeb89217410686e49))

## [0.3.2](https://github.com/pelotech/xapi-lrs/compare/v0.3.1...v0.3.2) (2026-05-12)


### Bug Fixes

* enforce statement page-size cap with default of 50 ([#53](https://github.com/pelotech/xapi-lrs/issues/53)) ([7ceeae1](https://github.com/pelotech/xapi-lrs/commit/7ceeae16286c1088976421a0806727c159ab098f))

## [0.3.1](https://github.com/pelotech/xapi-lrs/compare/v0.3.0...v0.3.1) (2026-05-12)


### Bug Fixes

* fail fast on startup if PGlite data directory is not writable ([#49](https://github.com/pelotech/xapi-lrs/issues/49)) ([646c2af](https://github.com/pelotech/xapi-lrs/commit/646c2afe18dbc6cc70817342439e7ec8823c349a))
* use exact SQUUID cursor for statement pagination ([#51](https://github.com/pelotech/xapi-lrs/issues/51)) ([11adfa4](https://github.com/pelotech/xapi-lrs/commit/11adfa4c6b6347bc953c8f2ff3088086de6de0b0))

## [0.3.0](https://github.com/pelotech/xapi-lrs/compare/v0.2.4...v0.3.0) (2026-05-12)


### Features

* add admin API endpoints: `/api/admin/credentials/*` ([#46](https://github.com/pelotech/xapi-lrs/issues/46)) ([6ac2d3f](https://github.com/pelotech/xapi-lrs/commit/6ac2d3fa7788bf659f5d5045834fa992a5738659))

## [0.2.4](https://github.com/pelotech/xapi-lrs/compare/v0.2.3...v0.2.4) (2026-05-05)


### Chores

* omit component name in docker image tag ([#42](https://github.com/pelotech/xapi-lrs/issues/42)) ([1cb6c23](https://github.com/pelotech/xapi-lrs/commit/1cb6c23fe3ea96a7a139a92cef98643cebed5b70))

## [0.2.3](https://github.com/pelotech/xapi-lrs/compare/xapi-lrs-v0.2.2...xapi-lrs-v0.2.3) (2026-05-04)


### Chores

* **deps:** update actions/download-artifact action to v8 ([#41](https://github.com/pelotech/xapi-lrs/issues/41)) ([0156d8c](https://github.com/pelotech/xapi-lrs/commit/0156d8c9055002ee66eed324bcc3221beeb5a57c))
* fix multi-arch container build & release ([#38](https://github.com/pelotech/xapi-lrs/issues/38)) ([87e32ee](https://github.com/pelotech/xapi-lrs/commit/87e32eea46422c971253b74ea62c95ad036544b9))

## [0.2.2](https://github.com/pelotech/xapi-lrs/compare/xapi-lrs-v0.2.1...xapi-lrs-v0.2.2) (2026-05-04)


### Chores

* build multi-arch images natively via matrix + manifest merge ([#32](https://github.com/pelotech/xapi-lrs/issues/32)) ([333bd04](https://github.com/pelotech/xapi-lrs/commit/333bd043170802e67e28ce8ba51768f83ea2b97b))
* **deps:** lock file maintenance ([#36](https://github.com/pelotech/xapi-lrs/issues/36)) ([11ec428](https://github.com/pelotech/xapi-lrs/commit/11ec428897c9b2a3718dc8be82e19f35c9f44d9d))
* **deps:** pin dependencies ([#34](https://github.com/pelotech/xapi-lrs/issues/34)) ([123fdca](https://github.com/pelotech/xapi-lrs/commit/123fdca12db07dbf56bacbbb235d51be13caa82a))
* **deps:** update github artifact actions ([#35](https://github.com/pelotech/xapi-lrs/issues/35)) ([6fb1ca0](https://github.com/pelotech/xapi-lrs/commit/6fb1ca02fe731c154f77689af2337152398aceb4))
* **deps:** update pnpm/action-setup digest to 8912a91 ([#37](https://github.com/pelotech/xapi-lrs/issues/37)) ([d72e3dd](https://github.com/pelotech/xapi-lrs/commit/d72e3ddafade1c55ccac68fb925faa53da89c115))

## [0.2.1](https://github.com/pelotech/xapi-lrs/compare/xapi-lrs-v0.2.0...xapi-lrs-v0.2.1) (2026-05-02)


### Bug Fixes

* **deps:** update dependency @hono/node-server to v2 ([#30](https://github.com/pelotech/xapi-lrs/issues/30)) ([36cf2e6](https://github.com/pelotech/xapi-lrs/commit/36cf2e6d72450c9e80930b296ac17b507ca4a51c))


### Chores

* **deps:** update all npm patch dependencies ([#28](https://github.com/pelotech/xapi-lrs/issues/28)) ([cd4b280](https://github.com/pelotech/xapi-lrs/commit/cd4b2801eb3920236b414fcb62da66b08973ff3e))
* **deps:** update node.js to v24.15.0 ([#29](https://github.com/pelotech/xapi-lrs/issues/29)) ([32891fd](https://github.com/pelotech/xapi-lrs/commit/32891fd55b95d8338677fe80eb48b66830389ff1))

## [0.2.0](https://github.com/pelotech/xapi-lrs/compare/xapi-lrs-v0.1.0...xapi-lrs-v0.2.0) (2026-05-02)


### Features

* add PGlite support as zero-infra alternative to PostgreSQL ([#23](https://github.com/pelotech/xapi-lrs/issues/23)) ([cead7b3](https://github.com/pelotech/xapi-lrs/commit/cead7b32e1b8544c33d3ec6e5245d6716897e0f3))
* optional migrate-on-startup via (existing) `graphile-migrate` ([#15](https://github.com/pelotech/xapi-lrs/issues/15)) ([e66c551](https://github.com/pelotech/xapi-lrs/commit/e66c551fc886c9a4375c7341b17caacce5e90e71))


### Chores

* bump deps with pending major version upgrades ([#27](https://github.com/pelotech/xapi-lrs/issues/27)) ([779becd](https://github.com/pelotech/xapi-lrs/commit/779becd3a0c4b1595ea343016106e452d30f903a))
* **deps:** pin dependencies ([#3](https://github.com/pelotech/xapi-lrs/issues/3)) ([da4deed](https://github.com/pelotech/xapi-lrs/commit/da4deed129e1945f843c2106ad64fdc4f74de5a2))
* **deps:** update actions/checkout action to v6 ([#18](https://github.com/pelotech/xapi-lrs/issues/18)) ([9d76cc9](https://github.com/pelotech/xapi-lrs/commit/9d76cc9b2bc4fa585fbc525b6ae9d3829ed81b8c))
* **deps:** update actions/setup-node action to v6 ([#19](https://github.com/pelotech/xapi-lrs/issues/19)) ([9491f5c](https://github.com/pelotech/xapi-lrs/commit/9491f5cc59ea20f4d6c7c408c807d1c99c2dc64c))
* **deps:** update all npm patch dependencies ([#4](https://github.com/pelotech/xapi-lrs/issues/4)) ([1e0f5c8](https://github.com/pelotech/xapi-lrs/commit/1e0f5c8ad0269367316bf1f2e5affea9cb83c92b))
* **deps:** update docker/build-push-action action to v7 ([#20](https://github.com/pelotech/xapi-lrs/issues/20)) ([8f780a5](https://github.com/pelotech/xapi-lrs/commit/8f780a589b142652b4682975dac84fa56b61e9ff))
* **deps:** update docker/setup-buildx-action action to v4 ([#21](https://github.com/pelotech/xapi-lrs/issues/21)) ([c40a985](https://github.com/pelotech/xapi-lrs/commit/c40a985a7e0bf4266c1441422a49c2b268793204))
* **deps:** update googleapis/release-please-action action to v5 ([#22](https://github.com/pelotech/xapi-lrs/issues/22)) ([1370c4b](https://github.com/pelotech/xapi-lrs/commit/1370c4b91aa2104753e9c86fce3716d29ede66f0))
* **deps:** update node.js to v24.14.1 ([#14](https://github.com/pelotech/xapi-lrs/issues/14)) ([b290e15](https://github.com/pelotech/xapi-lrs/commit/b290e15d8241bef4f66b27a8ed0fda1c704f6ffd))
* **deps:** update pnpm to v10.33.0 ([#17](https://github.com/pelotech/xapi-lrs/issues/17)) ([52f1267](https://github.com/pelotech/xapi-lrs/commit/52f12672455ea639a44df301c50e86aba3b73e7b))
* **deps:** update pnpm/action-setup action to v6 ([#24](https://github.com/pelotech/xapi-lrs/issues/24)) ([9b8fa63](https://github.com/pelotech/xapi-lrs/commit/9b8fa63ba11f63af34fdd3b5634278a0bbfcb12a))

## [0.1.0](https://github.com/pelotech/xapi-lrs/compare/xapi-lrs-v0.0.1...xapi-lrs-v0.1.0) (2026-05-01)


### Features

* initial import of xAPI LRS service ([2d41010](https://github.com/pelotech/xapi-lrs/commit/2d41010a3d3ef8e1e04e03ec423a422de58c93a8))


### Chores

* add release-please workflow ([4c5319d](https://github.com/pelotech/xapi-lrs/commit/4c5319da709b60be1643e12cc50af65f7a9449d0))
