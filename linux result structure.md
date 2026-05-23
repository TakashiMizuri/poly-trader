root@vm15869856:/opt/poly-trader# tree -a -L 5
.
├── AGENTS.md
├── client
│   ├── components.json
│   ├── eslint.config.js
│   ├── .gitignore
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── public
│   │   ├── favicon.svg
│   │   ├── fonts
│   │   │   ├── geist-latin.woff2
│   │   │   └── geist-mono-latin.woff2
│   │   └── icons.svg
│   ├── README.md
│   ├── scripts
│   │   └── sync-fonts.mjs
│   ├── src
│   │   ├── api
│   │   │   ├── client.ts
│   │   │   ├── hooks.ts
│   │   │   ├── poll-cache.ts
│   │   │   ├── signalR.ts
│   │   │   └── tradingLive.tsx
│   │   ├── App.tsx
│   │   ├── assets
│   │   │   ├── hero.png
│   │   │   ├── react.svg
│   │   │   └── vite.svg
│   │   ├── components
│   │   │   ├── app-ui.tsx
│   │   │   ├── AuthGate.tsx
│   │   │   ├── ChartContextMenu.tsx
│   │   │   ├── ChartSettingsDialog.tsx
│   │   │   ├── DashboardBalanceChart.tsx
│   │   │   ├── DashboardBalancePanel.tsx
│   │   │   ├── DashboardEnginePanel.tsx
│   │   │   ├── EventWindowProgressFill.tsx
│   │   │   ├── HeaderConnectivity.tsx
│   │   │   ├── Layout.tsx
│   │   │   ├── LiveChart.tsx
│   │   │   ├── LiveLogsSidebar.tsx
│   │   │   ├── MarketCell.tsx
│   │   │   ├── PaperTradingSettingsDialog.tsx
│   │   │   ├── PositionsPanel.tsx
│   │   │   ├── SettingsDialog.tsx
│   │   │   ├── StakeRestartConfirmDialog.tsx
│   │   │   ├── StakeSettingsDialog.tsx
│   │   │   ├── status-lights.tsx
│   │   │   ├── TradeHistoryTable.tsx
│   │   │   └── ui
│   │   │       ├── alert.tsx
│   │   │       ├── badge.tsx
│   │   │       ├── button.tsx
│   │   │       ├── card.tsx
│   │   │       ├── checkbox.tsx
│   │   │       ├── dialog.tsx
│   │   │       ├── draft-number-input.tsx
│   │   │       ├── input-group.tsx
│   │   │       ├── input.tsx
│   │   │       ├── label.tsx
│   │   │       ├── number-input.tsx
│   │   │       ├── select.tsx
│   │   │       ├── skeleton.tsx
│   │   │       └── textarea.tsx
│   │   ├── constants
│   │   │   └── marketData.ts
│   │   ├── context
│   │   │   ├── PaperTradingContext.tsx
│   │   │   ├── ThemeContext.tsx
│   │   │   └── TimeFormatContext.tsx
│   │   ├── fonts.css
│   │   ├── hooks
│   │   │   ├── useBinanceLiveCandles.ts
│   │   │   ├── useChartDisplayPrefs.ts
│   │   │   └── useEventWindowProgress.ts
│   │   ├── index.css
│   │   ├── lib
│   │   │   ├── appReset.ts
│   │   │   ├── candleCache.ts
│   │   │   ├── chartDisplayPrefs.ts
│   │   │   ├── chartTheme.ts
│   │   │   ├── displayLocale.ts
│   │   │   ├── engineStakeSettings.ts
│   │   │   ├── limitEntryFeasibility.ts
│   │   │   ├── liveLogLevelFilter.ts
│   │   │   ├── paperTrading.ts
│   │   │   ├── polymarket.ts
│   │   │   ├── positionDisplay.ts
│   │   │   ├── theme.ts
│   │   │   ├── timeFormat.ts
│   │   │   └── utils.ts
│   │   ├── main.tsx
│   │   ├── pages
│   │   │   └── DashboardPage.tsx
│   │   ├── services
│   │   │   └── binanceMarketService.ts
│   │   ├── types
│   │   │   ├── blendFade2Config.ts
│   │   │   ├── candle.ts
│   │   │   ├── liveLog.ts
│   │   │   ├── timeframe.ts
│   │   │   └── trendBetStrategy.ts
│   │   ├── utils
│   │   │   ├── chart
│   │   │   │   ├── blendFade2Signals.ts
│   │   │   │   ├── chartTimeScale.ts
│   │   │   │   ├── detectBreakOfStructure.ts
│   │   │   │   ├── findNearestCandle.ts
│   │   │   │   ├── futureWhitespaceSeries.ts
│   │   │   │   ├── predictCandleDirectionAtOpen.ts
│   │   │   │   ├── resolveBetAtOpen.ts
│   │   │   │   ├── safeBetStake.ts
│   │   │   │   ├── simulateTrendBetStrategy.ts
│   │   │   │   └── structureMath.ts
│   │   │   └── chartPrimitives
│   │   │       ├── BacktestStatsPanePrimitive.ts
│   │   │       ├── BetMarkersPrimitive.ts
│   │   │       ├── BosOverlayPrimitive.ts
│   │   │       ├── EngineMarkersPrimitive.ts
│   │   │       └── timeScaleCoordinate.ts
│   │   └── vite-env.d.ts
│   ├── tsconfig.app.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── deploy
│   ├── backup.sh
│   ├── nginx
│   │   └── poly-trader.conf
│   ├── OPERATIONS.ru.md
│   ├── setup-server.sh
│   └── update.sh
├── DEPLOY.ru.md
├── docker
│   └── nginx.conf
├── docker-compose.prod.yml
├── docker-compose.yml
├── Dockerfile
├── Dockerfile.client
├── .dockerignore
├── docs
│   └── blend_fade2
│       └── STRATEGY.md
├── .env
├── .env.example
├── .git
│   ├── branches
│   ├── config
│   ├── description
│   ├── FETCH_HEAD
│   ├── HEAD
│   ├── hooks
│   │   ├── applypatch-msg.sample
│   │   ├── commit-msg.sample
│   │   ├── fsmonitor-watchman.sample
│   │   ├── post-update.sample
│   │   ├── pre-applypatch.sample
│   │   ├── pre-commit.sample
│   │   ├── pre-merge-commit.sample
│   │   ├── prepare-commit-msg.sample
│   │   ├── pre-push.sample
│   │   ├── pre-rebase.sample
│   │   ├── pre-receive.sample
│   │   ├── push-to-checkout.sample
│   │   ├── sendemail-validate.sample
│   │   └── update.sample
│   ├── index
│   ├── info
│   │   └── exclude
│   ├── logs
│   │   ├── HEAD
│   │   └── refs
│   │       ├── heads
│   │       │   └── main
│   │       └── remotes
│   │           └── origin
│   ├── objects
│   │   ├── 08
│   │   │   └── 635d6cc0095b8b8bdeabf392336abbeb9fb593
│   │   ├── 0b
│   │   │   └── 19dc9a6c9b3a0945922705b958751b890ba3d3
│   │   ├── 0c
│   │   │   ├── 153851447d7bb5af4ffc6a834e76ad57c5aafb
│   │   │   ├── 8797d8bc828b8f0c30fea3460f7e2240ed6118
│   │   │   └── e2d5dce5024f9fd670717ed510a2a310789f96
│   │   ├── 0e
│   │   │   ├── 02f42bd9f38aededa359c228d1b2717b4fb2fe
│   │   │   ├── 254bb0b117a0cbcc3fa525580558bf78cf47e5
│   │   │   └── 779bcc61c94a8a3f809d0bca7f823eabdd5eb9
│   │   ├── 12
│   │   │   └── 137193b2773ec9989028df9881b7c688c65844
│   │   ├── 14
│   │   │   ├── a4be928631c6670feada86adf515a8ee88286b
│   │   │   └── f3865f6faa1eef52146c8af215338bbc77b93d
│   │   ├── 15
│   │   │   └── 8b408e70867bb539b525a9fa4ad1157c51311f
│   │   ├── 1a
│   │   │   ├── 62606165f2dba2903783ac4cf145c127d45563
│   │   │   └── 8f8bccdea30c91aceea79d38dd9115049e2a88
│   │   ├── 1c
│   │   │   ├── d6302a3e0c8d535fd63cbfd9e7975449a1da38
│   │   │   └── e7396fdc256d94934fa035a581d207732d0539
│   │   ├── 1d
│   │   │   └── b2ab7e0c7bf7ed65cf231ef46ee0e8ba5d4063
│   │   ├── 1e
│   │   │   └── 4333017878e32d765ffdab5b53dcfcb1390abc
│   │   ├── 1f
│   │   │   ├── 0417836b41dc87b6a613a39f63a662bb422361
│   │   │   ├── 46ec2b4eb0ae597476b8e06b12c618a79a88d6
│   │   │   └── 905682ebb060cb34963ba910b8e3e13c45dc98
│   │   ├── 22
│   │   │   └── 7c460f5a7ebd21b85a76a111491c89355d670c
│   │   ├── 23
│   │   │   └── 30101bc20c7c4491a9b6f72cb062718620717e
│   │   ├── 25
│   │   │   └── 182cf8425f5cb5e429b719071e79e30b345b89
│   │   ├── 27
│   │   │   └── 073728074a5ab4f38a5ff74310243b53630946
│   │   ├── 29
│   │   │   └── 161da2c04318d304b67a6956c8bf910d2a0737
│   │   ├── 2b
│   │   │   └── 7f3d239c7c01febc2043eedb86500a882f2a5b
│   │   ├── 2c
│   │   │   └── c96eec46d64e47382be23f55d83e94e903d4bd
│   │   ├── 2d
│   │   │   └── 75cac70facd941f864f375c76a6dfce9c5b3a0
│   │   ├── 2e
│   │   │   └── f94ab402dd71564e169db629acf6ea81d35842
│   │   ├── 3a
│   │   │   └── c7974732642f9c47137fab2791a286516dc42d
│   │   ├── 3c
│   │   │   └── ebd23d24c6ebb307325b28188b4789cc0303b3
│   │   ├── 3f
│   │   │   └── 72ee10cb4db9e1716d8e1998e0b48109f10e92
│   │   ├── 42
│   │   │   └── 032ec7c26067ea2a273151661cf161cbe48ea5
│   │   ├── 43
│   │   │   └── 01091d4335df7e9822eb9a70c7329dad733466
│   │   ├── 44
│   │   │   ├── 6d1f5cffcfa5649c7e282c061497bb978e98c9
│   │   │   └── d937b7c28ab0c166c403039a9894815da46c56
│   │   ├── 46
│   │   │   └── 09fc2ab92a838a03c33334660c7e831aae4d05
│   │   ├── 48
│   │   │   └── 2d4fafb6f86e688ed2b05539e73b32d957f8b4
│   │   ├── 49
│   │   │   └── 17956852ed9e7e1546df72d69d57841751a964
│   │   ├── 4a
│   │   │   ├── 3ec31bb6331ab98ccf21d44e01e44f60c9915d
│   │   │   └── ca94ad33691e11eebe113c7c410f1c4cfc9bdc
│   │   ├── 4d
│   │   │   └── 47759acedff6b05519d2cf872b3ad4d7fb9613
│   │   ├── 4e
│   │   │   └── 8cc5eaa8a0696a076232710b099a222c81de62
│   │   ├── 4f
│   │   │   ├── 00dcac97b9a69e9f0a17e46ff076e6670251e7
│   │   │   └── f319e61e025d8d1f433d4eea69b61e1f269964
│   │   ├── 50
│   │   │   ├── 057027b5dc650b48fae248d56e3ea331ef0062
│   │   │   └── d16f22a68dd48efb839a3c082eee364327ae95
│   │   ├── 51
│   │   │   └── 49fb42c907417a2c747afa3df70f4bdbcd9a0c
│   │   ├── 53
│   │   │   └── 044fae9fc65d99b204c9756016590eef7ca7be
│   │   ├── 55
│   │   │   └── 15014a145e4240b72bd2080d65c1b147341373
│   │   ├── 56
│   │   │   ├── e30766c7c1555f6a13ec65784f0fcf656f5d5e
│   │   │   └── e8215198ef4030420808e84ed45268fa1bbb2a
│   │   ├── 57
│   │   │   └── de795b6f4d6507dc245494a50c274d59de88ff
│   │   ├── 58
│   │   │   ├── 38a218ad7a4084260aa8da099e8e8c55d257c5
│   │   │   └── a486f5260802487f9a39d66537ad8264389b9e
│   │   ├── 59
│   │   │   └── bd966d15dc1cbcd92c1349c0c9c9c526b4de52
│   │   ├── 5a
│   │   │   ├── 5cb63c28e44f0febf16bbb00cf147a7375da96
│   │   │   ├── 6ead9b7ac184011f524996cc72a2b16d7ac9d2
│   │   │   └── e5835f958c13a5d43b2247c09305e19763924e
│   │   ├── 5b
│   │   │   └── ed353705d678dab3db2b046ded7c3b1201aa3d
│   │   ├── 5e
│   │   │   └── 8187a8550abf8d0f8286ddefe0ea05108a0597
│   │   ├── 5f
│   │   │   └── 27fbf29f03e11253bd4a75e0edf1e3d0f96f96
│   │   ├── 61
│   │   │   └── 23f5a6d7e526f636cda4a97d15c7e9e2d7757d
│   │   ├── 64
│   │   │   └── 901dba8099211ea4f9d6303d3365abcc28dbc2
│   │   ├── 65
│   │   │   ├── 2ec2a60b54020f01973cb401abe82b560ed714
│   │   │   └── 33c199620c46ca3168f98e48fb49b299aa4d5b
│   │   ├── 69
│   │   │   └── e9a77ef58ed25cbc09731cd062f07bb6a58b3e
│   │   ├── 6a
│   │   │   ├── 16d592202359f73115c2e93ec93034611d5dfe
│   │   │   └── 2e72c9eeb75b3b6d80d1c7e6191cfef65c986d
│   │   ├── 6c
│   │   │   ├── 30341824b5bdeeeed40eab481791f2ba4b2cb0
│   │   │   └── 751ee41ab5007c7a62a65213f5b548cac9ff7a
│   │   ├── 6d
│   │   │   └── d1f365641afce82d0bcf6b7b20aa6505bd7ccf
│   │   ├── 6e
│   │   │   └── 0f600646822316abf25f1467bbe577e6dcdf88
│   │   ├── 73
│   │   │   └── f3ad0f07399743eda7c558d581703032d2fb00
│   │   ├── 76
│   │   │   ├── 00890d15427a67fde8b6386307148e921eda8f
│   │   │   └── 22365f86713d7ec47d68604501af412466005c
│   │   ├── 77
│   │   │   ├── 41bf1f431035316b54d84038d6522f27ee2fbf
│   │   │   ├── 5b4fbb7ecdba5bd96a16a541d2f7b31b0efa73
│   │   │   └── b71e7987e5803067b36262099089968e99c942
│   │   ├── 78
│   │   │   └── bd78a05c7d8a865e0260f4a2112ec7119a7d90
│   │   ├── 7b
│   │   │   └── 85d47f12ad872611b258cfd5af04ebae30740e
│   │   ├── 7c
│   │   │   └── 5660b5ecbef4a993b810bbe5cd3918f49cb848
│   │   ├── 7d
│   │   │   └── a3d09d7e8962d5c91f97b659a605055476d676
│   │   ├── 7e
│   │   │   └── 5c94dbd1518756f246fdbc57a0c67c9ddf3527
│   │   ├── 84
│   │   │   └── 41c6d62cce4211c319e76159967b4039c9f2a0
│   │   ├── 85
│   │   │   └── 3dbedbbda8b4c4e0ac76de84c27150c4ac8cae
│   │   ├── 86
│   │   │   ├── 0283d891d8d309e0659564cfb7d7e31b002e31
│   │   │   ├── b8e8b027eba9bbeaed9d488584cd00da768169
│   │   │   └── f5b228840ddf3f6e9abf8a5799e63659f2dfc5
│   │   ├── 87
│   │   │   ├── 6d48b75e737c762e1ae7d97759b36b2ad24755
│   │   │   └── b2a213b928b1286be194761da2c355122996ab
│   │   ├── 8a
│   │   │   └── 2f1ac835c12c9158a264f66236183cbfd3b676
│   │   ├── 8d
│   │   │   └── 2528834fc2e57fbaa820344912f973684c7022
│   │   ├── 8e
│   │   │   └── c6bb69e6fced84e55a4804da021d79919de985
│   │   ├── 8f
│   │   │   └── 8a191320900066fc61cab67c1c643212a61b15
│   │   ├── 91
│   │   │   └── c6eb0b5fde7f19ae86fbb7275135bfd6e00082
│   │   ├── 92
│   │   │   └── 27482dc59bd22173f93377e3690a533d6f1366
│   │   ├── 95
│   │   │   └── aa2796c5e0457cdc7d526c0fae81eb9413cdf4
│   │   ├── 96
│   │   │   ├── 75507e0b600acb4e087e23d8d652a7074b1c92
│   │   │   └── 7b64d1a50a2a2700ea59650b191fcb7f3714b5
│   │   ├── 99
│   │   │   └── d466655a313f4f9ce43c286ce43e7b37e5d2b0
│   │   ├── 9c
│   │   │   ├── 9c3509f99d3554879090f955ee8baf3513bfb7
│   │   │   └── ab7695f4f90a34493c5221b59b8bd6ae3817c0
│   │   ├── 9d
│   │   │   └── e1140325e3a55af22cfbbd49d393997bc4512e
│   │   ├── 9e
│   │   │   └── fd52fec4f490c4f0f45fbd4c7892e5183c61f4
│   │   ├── a0
│   │   │   └── f7b220239fe3358bf9e44eafe0a9559c59ca20
│   │   ├── a1
│   │   │   └── 0b2e38d716647738f90b83b32721d60c1ddfd3
│   │   ├── a2
│   │   │   ├── a6f2c812e4a2ecdb550ae73da53007a6d23623
│   │   │   └── b8dc1e87bb90ba5134e798651debcbbdf28efb
│   │   ├── a4
│   │   │   └── 149716d46dc992a6c1bde87df0a6620f81aeb9
│   │   ├── a5
│   │   │   └── f75061cdb1010b8f17c83364d8dd401d92ed64
│   │   ├── a9
│   │   │   └── 79b3fdc01037eec7495f8ae5ba728122b916f5
│   │   ├── ab
│   │   │   ├── 2f6c577152470077a3875a831b83aba9e7693d
│   │   │   └── d78187cc896164c4d74dc3ec348a042d1b076f
│   │   ├── b0
│   │   │   └── 1d1b7ba368d91d0f1ad7c83ec14c7398b6ee18
│   │   ├── b1
│   │   │   └── a398b5eba7d669d3941cd275e137740f4bda62
│   │   ├── b4
│   │   │   └── 6acdf2fb830e5254339df05533c45a779b7490
│   │   ├── b5
│   │   │   └── 577721998f669597209c8551a4c5b8f0d2a94a
│   │   ├── b6
│   │   │   ├── 09f02ac35331fa69b2b8d064a841a8b6d9d1e8
│   │   │   └── ffb5f33e684ac21f4a0a50f519317ea4a0b465
│   │   ├── ba
│   │   │   └── 0b2f62718ca3891feccba28950e4ab18a40b6a
│   │   ├── bd
│   │   │   └── 182d5524c9484929145edf145b5ed13097aded
│   │   ├── be
│   │   │   ├── 6825a1028edda9c5105c95be5c54195b9c467b
│   │   │   └── b8370755b9607d4a1ddbb2d4d37d742294e1cb
│   │   ├── c1
│   │   │   └── 3aa01cf9c3a8327747dbe4e845c2c193e081fe
│   │   ├── c2
│   │   │   └── 00b2a256c8b5d27fd207fea55ea24b5c6553a1
│   │   ├── c3
│   │   │   └── 12b427147c21b766438404a390d3c081aa2f8f
│   │   ├── c4
│   │   │   └── 2abb2d1493ce5720f2f663a245a55edcb82b50
│   │   ├── ca
│   │   │   └── 29cb5549e501c41499a50b30d3e2a724e03dd7
│   │   ├── d3
│   │   │   └── c372f8c3153b5db14d0c5ac29cd3e619d5185e
│   │   ├── de
│   │   │   └── 0690f58bc03cbbe25bfa599feae0df303bdb45
│   │   ├── df
│   │   │   ├── 27d512eada4f21374ebc3f51557fc2018fcdeb
│   │   │   └── 30e4edf3a53b76460de11d508eaeb092b00e9d
│   │   ├── e1
│   │   │   └── 4cf7fb892239fe6afffe4243168939b2bfc5a6
│   │   ├── e4
│   │   │   └── cf69d4bf5a83f7be3a2574ec130e94c228621b
│   │   ├── e6
│   │   │   └── cd88a8bc0bd7991851f445db3d5ca3a80dac5f
│   │   ├── e9
│   │   │   ├── 47ba0acbe402de894de36aff3511f8cb6762b3
│   │   │   └── d8ee0d6b7a7f04703f04b261153888b149ff78
│   │   ├── ea
│   │   │   └── 7a142977d52fbff0a4a59fe8f004c13ef30484
│   │   ├── ed
│   │   │   └── 65e513e560478a36f61004a8b10c1673ce5539
│   │   ├── f3
│   │   │   └── c6108a4ce02a26181c245a16691c25e5984e92
│   │   ├── f4
│   │   │   ├── 23341746406e54af2f819c9f5633e799b8bce8
│   │   │   └── b36219298dd6cc7ebc34056813d1be2a3e360b
│   │   ├── f5
│   │   │   └── 6aa6653405d4e050f6a734a79155ec1388ce15
│   │   ├── fa
│   │   │   └── 91bb230010ebd56a3569efaf3eb2d0e11e021c
│   │   ├── info
│   │   └── pack
│   │       ├── pack-b00c9a07003b5c1cac3ff89feeb742b7327faa0e.idx
│   │       ├── pack-b00c9a07003b5c1cac3ff89feeb742b7327faa0e.pack
│   │       └── pack-b00c9a07003b5c1cac3ff89feeb742b7327faa0e.rev
│   ├── ORIG_HEAD
│   ├── packed-refs
│   └── refs
│       ├── heads
│       │   └── main
│       ├── remotes
│       │   └── origin
│       │       ├── HEAD
│       │       └── main
│       └── tags
├── .gitignore
├── PolyTrader.sln
├── PolyTrader.slnx
├── README.md
├── references
│   ├── poly-screener
│   ├── poly-shine
│   │   ├── AGENTS.md
│   │   ├── apps
│   │   │   ├── api
│   │   │   │   ├── package.json
│   │   │   │   ├── src
│   │   │   │   └── tsconfig.json
│   │   │   ├── bot
│   │   │   │   ├── package.json
│   │   │   │   ├── src
│   │   │   │   └── tsconfig.json
│   │   │   ├── web
│   │   │   │   ├── components.json
│   │   │   │   ├── index.html
│   │   │   │   ├── package.json
│   │   │   │   ├── src
│   │   │   │   ├── tsconfig.json
│   │   │   │   ├── tsconfig.node.json
│   │   │   │   └── vite.config.ts
│   │   │   └── worker
│   │   │       ├── package.json
│   │   │       ├── src
│   │   │       └── tsconfig.json
│   │   ├── docs
│   │   │   ├── MEHANIZMY-SLEDOVANIYA.md
│   │   │   └── start.md
│   │   ├── .env.example
│   │   ├── .gitignore
│   │   ├── package.json
│   │   ├── package-lock.json
│   │   ├── packages
│   │   │   ├── db
│   │   │   │   ├── drizzle
│   │   │   │   ├── drizzle.config.ts
│   │   │   │   ├── package.json
│   │   │   │   ├── src
│   │   │   │   ├── tsconfig.json
│   │   │   │   └── tsconfig.tsbuildinfo
│   │   │   └── shared
│   │   │       ├── package.json
│   │   │       ├── src
│   │   │       ├── tsconfig.json
│   │   │       └── tsconfig.tsbuildinfo
│   │   ├── RUN_OPERATOR.md
│   │   ├── tsconfig.json
│   │   └── turbo.json
│   └── shine-trader
│       ├── AGENTS.md
│       ├── docs
│       │   └── candle-direction-autotrading-spec.md
│       ├── scripts
│       │   ├── candle-direction-backtest.mjs
│       │   ├── honest-strategy-search.mjs
│       │   └── validate-honest-strategy.mjs
│       ├── shine-trader-client
│       ├── shine-trader-server
│       ├── start.md
│       ├── tmp_btc_5m_2023.json
│       ├── tmp_btc_5m_2024.json
│       ├── tmp_btc_5m_2025.json
│       ├── tmp_btc_5m_year.json
│       ├── tmp-candles-15m.json
│       ├── tmp-candles-1h.json
│       ├── tmp_candles_2015-02-26.json
│       ├── tmp_candles_2016.json
│       ├── tmp-candles.json
│       ├── tmp_candles.json
│       ├── tmp-candles-mar.json
│       ├── tmp_v_2015-01-26.json
│       ├── tmp_v_2016-06-01.json
│       ├── tmp_v_2017-01-15.json
│       ├── tmp_v_2018-09-01.json
│       └── tmp_v_2020-03-01.json
├── RUN_OPERATOR.md
├── scripts
│   ├── compare_blend_fade2_year.py
│   ├── compare-signals.mjs
│   └── export_blend2_parity.py
├── src
│   ├── PolyTrader.Api
│   │   ├── appsettings.Development.json
│   │   ├── appsettings.json
│   │   ├── appsettings.Production.json
│   │   ├── Controllers
│   │   │   ├── BalanceController.cs
│   │   │   ├── EngineController.cs
│   │   │   ├── HealthController.cs
│   │   │   ├── MarketController.cs
│   │   │   ├── PaperAccountsController.cs
│   │   │   ├── PositionsController.cs
│   │   │   ├── ResetController.cs
│   │   │   └── TradesController.cs
│   │   ├── EnvFileLoader.cs
│   │   ├── HostedServices
│   │   │   └── TelegramBotHostedService.cs
│   │   ├── Hubs
│   │   │   └── TradingHub.cs
│   │   ├── Logging
│   │   │   ├── ILiveLogBroadcaster.cs
│   │   │   ├── LiveLogBroadcaster.cs
│   │   │   ├── LiveLogEntry.cs
│   │   │   ├── SerilogBootstrap.cs
│   │   │   ├── SerilogLiveStreamExtensions.cs
│   │   │   ├── SerilogLiveStreamSink.cs
│   │   │   └── SerilogLogFileClearService.cs
│   │   ├── Middleware
│   │   │   └── ApiTokenMiddleware.cs
│   │   ├── PolyTrader.Api.csproj
│   │   ├── PolyTrader.Api.http
│   │   ├── Program.cs
│   │   ├── Properties
│   │   │   └── launchSettings.json
│   │   └── Services
│   │       ├── CompositeTradingEventPublisher.cs
│   │       ├── SignalRTradingEventPublisher.cs
│   │       ├── TelegramTradingEventPublisher.cs
│   │       └── TradeFeedBuilder.cs
│   ├── PolyTrader.Core
│   │   ├── Abstractions
│   │   │   ├── IEngineSettingsService.cs
│   │   │   ├── ILogFileClearService.cs
│   │   │   ├── ITelegramNotifier.cs
│   │   │   └── ITradingEventPublisher.cs
│   │   ├── Models
│   │   │   ├── ChartCandle.cs
│   │   │   ├── EngineSettingsModels.cs
│   │   │   ├── EntryFailedEvent.cs
│   │   │   ├── LiveEntryOrderModes.cs
│   │   │   └── MarketTrend.cs
│   │   ├── PolyTrader.Core.csproj
│   │   └── Strategy
│   │       ├── BetResolver.cs
│   │       ├── BetStakeResolver.cs
│   │       ├── BlendFade2Config.cs
│   │       ├── BlendFade2Signals.cs
│   │       ├── BreakOfStructureAnalyzer.cs
│   │       ├── CandleIntervalHelper.cs
│   │       ├── LimitEntryRules.cs
│   │       ├── SafeBetStake.cs
│   │       ├── StructureMath.cs
│   │       ├── TrendBetStrategyParams.cs
│   │       └── TrendBetStrategySimulator.cs
│   └── PolyTrader.Infrastructure
│       ├── Binance
│       │   └── BinanceMarketService.cs
│       ├── Data
│       │   └── PolyTraderDbContext.cs
│       ├── DependencyInjection.cs
│       ├── EngineSettingsExtensions.cs
│       ├── EngineStakeSettings.cs
│       ├── Entities
│       │   ├── BalanceSnapshotEntity.cs
│       │   ├── CandleSnapshotEntity.cs
│       │   ├── EngineSettingsEntity.cs
│       │   ├── MarketEntity.cs
│       │   ├── PaperAccountEntity.cs
│       │   ├── PositionEntity.cs
│       │   ├── SkippedBetEntity.cs
│       │   └── TradeEntity.cs
│       ├── Logging
│       │   └── ApplicationLogPaths.cs
│       ├── Migrations
│       │   ├── 20260519150147_Initial.cs
│       │   ├── 20260519150147_Initial.Designer.cs
│       │   ├── 20260520124011_SkippedBets.cs
│       │   ├── 20260520124011_SkippedBets.Designer.cs
│       │   ├── 20260520154029_EngineStakeSizing.cs
│       │   ├── 20260520154029_EngineStakeSizing.Designer.cs
│       │   ├── 20260520160624_EngineStakePending.cs
│       │   ├── 20260520160624_EngineStakePending.Designer.cs
│       │   ├── 20260521130559_BalanceSnapshotCandleTime.cs
│       │   ├── 20260521130559_BalanceSnapshotCandleTime.Designer.cs
│       │   ├── 20260521140000_TradeRedeemedAt.cs
│       │   ├── 20260521140000_TradeRedeemedAt.Designer.cs
│       │   ├── 20260521152022_TradeRequestedStakeUsd.cs
│       │   ├── 20260521152022_TradeRequestedStakeUsd.Designer.cs
│       │   ├── 20260522120000_EngineAutoRedeemEnabled.cs
│       │   ├── 20260522180000_TradeEntryWavesJson.cs
│       │   ├── 20260523120000_EngineLiveEntryOrderMode.cs
│       │   └── PolyTraderDbContextModelSnapshot.cs
│       ├── Options
│       │   └── PolyTraderOptions.cs
│       ├── Polymarket
│       │   ├── Ctf
│       │   │   └── RedeemPositionsFunction.cs
│       │   ├── ILiveTradeSettlementService.cs
│       │   ├── IPolymarketCtfRedeemService.cs
│       │   ├── IPolymarketRedeemService.cs
│       │   ├── IPolymarketRestTradingClient.cs
│       │   ├── LiveEntryOrderKey.cs
│       │   ├── LiveEntryWaveFill.cs
│       │   ├── LiveMarketBuyOutcome.cs
│       │   ├── LiveMarketBuyResult.cs
│       │   ├── LiveTradeSettlementService.cs
│       │   ├── PolymarketClobLimits.cs
│       │   ├── PolymarketClobService.cs
│       │   ├── PolymarketConditionId.cs
│       │   ├── PolymarketCtfConstants.cs
│       │   ├── PolymarketCtfRedeemService.cs
│       │   ├── PolymarketDataApiService.cs
│       │   ├── PolymarketGammaService.cs
│       │   ├── PolymarketMarketWebSocket.cs
│       │   ├── PolymarketOrderPricing.cs
│       │   ├── PolymarketRedeemService.cs
│       │   ├── PolymarketRestTradingClient.cs
│       │   ├── PolymarketWalletResolver.cs
│       │   └── TradeEntryWavesJson.cs
│       ├── PolyTrader.Infrastructure.csproj
│       ├── Services
│       │   ├── BalanceHistoryService.cs
│       │   ├── BalanceSnapshotRecorder.cs
│       │   ├── ConnectivityService.cs
│       │   ├── EngineSettingsService.cs
│       │   ├── GlobalResetService.cs
│       │   ├── InProgressWindowSkipService.cs
│       │   ├── LimitEntryPreviewService.cs
│       │   ├── PolymarketRedeemHostedService.cs
│       │   ├── TradeRedeemRecorder.cs
│       │   └── TradingEngineHostedService.cs
│       └── Telegram
│           ├── BalanceChartImageBuilder.cs
│           ├── TelegramAdminIds.cs
│           └── TelegramNotifier.cs
├── STRATEGY.md
├── tests
│   ├── fixtures
│   │   └── binance_btcusdt_5m_500.json
│   ├── golden_blend2_2022_python.json
│   ├── parity_blend2.json
│   └── PolyTrader.Core.Tests
│       ├── BlendFade2ParityTests.cs
│       ├── BlendFade2YearCompareTests.cs
│       ├── LimitEntryRulesTests.cs
│       ├── PolymarketConditionIdTests.cs
│       ├── PolymarketCtfRedeemTests.cs
│       ├── PolymarketWalletResolverTests.cs
│       ├── PolyTrader.Core.Tests.csproj
│       └── StrategyGoldenTests.cs
└── tmp_binance_100.json

205 directories, 491 files
root@vm15869856:/opt/poly-trader#