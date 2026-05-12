# Changelog

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
