# References

[1] YoobieRE, `ubisoft-demux-node` README. Describes Ubisoft Connect's Demux socket/protobuf protocol, Demux authentication with a UbiServices ticket, and service connections. https://raw.githubusercontent.com/YoobieRE/ubisoft-demux-node/master/Readme.md

[2] YoobieRE, `ubisoft-demux-node/src/ubiservices-api.ts`. Shows HTTP session creation against `https://public-ubiservices.ubi.com/v3/profiles/sessions` with Basic auth, 2FA headers, remember-me refresh, and the `Ubi-AppId` header. https://raw.githubusercontent.com/YoobieRE/ubisoft-demux-node/master/src/ubiservices-api.ts

[3] YoobieRE, `ubisoft-demux-node/src/ubisoft-file-parser.ts`. Documents local Ubisoft file formats and parsing offsets for ownership cache, download manifests, metadata, licenses, and install state. https://raw.githubusercontent.com/YoobieRE/ubisoft-demux-node/master/src/ubisoft-file-parser.ts

[4] UplayDB, `UplayKit/UplayKit/Connection/OwnershipConnection.cs`. Shows Demux ownership-service initialization, owned-game enumeration, ownership token retrieval, product-config retrieval, and related request fields (`UbiTicket`, `UbiSessionId`, proto version 7). https://raw.githubusercontent.com/UplayDB/UplayKit/main/UplayKit/Connection/OwnershipConnection.cs

[5] UplayDB, `UplayKit/UplayKit/Connection/DownloadConnection.cs`. Shows download-service initialization with an ownership token and URL requests for `manifests/<manifest>.manifest|metadata|licenses`. https://raw.githubusercontent.com/UplayDB/UplayKit/main/UplayKit/Connection/DownloadConnection.cs

[6] Syed Ahkam, `ubi-cli/src/client.rs`. Shows authenticated REST usage for `GET /v3/users/{userId}` and GraphQL usage for `POST /v1/profiles/me/uplay/graphql`. https://raw.githubusercontent.com/SyedAhkam/ubi-cli/master/src/client.rs

[7] Syed Ahkam, `ubi-cli/src/lib.rs`. Records one public Ubisoft web app ID (`314d4fef-e568-454a-ae06-43e3bece12a6`) and genome ID (`85c31714-0941-4876-a18d-2c7e9dce8d40`) used by that client. https://raw.githubusercontent.com/SyedAhkam/ubi-cli/master/src/lib.rs

[8] Syed Ahkam, `ubi-cli/src/commands/auth/login.rs`. Shows a browser/webview login approach that extracts `PRODloginData` from Ubisoft Connect web storage after redirecting to `/ready`. https://raw.githubusercontent.com/SyedAhkam/ubi-cli/master/src/commands/auth/login.rs

[9] Lutris, `lutris/util/ubisoft/client.py`. Shows production usage of Ubisoft session refresh (`PUT /v3/profiles/sessions` and remember-me refresh), GraphQL owned-games queries, and credential persistence. https://raw.githubusercontent.com/lutris/lutris/master/lutris/util/ubisoft/client.py

[10] Lutris, `lutris/util/ubisoft/consts.py`. Records another public Ubisoft Connect web app ID (`82b650c0-6cb3-40c0-9f41-25a53b62b206`), genome ID (`42d07c95-9914-4450-8b38-267c4e462b21`), and login URL shape. https://raw.githubusercontent.com/lutris/lutris/master/lutris/util/ubisoft/consts.py

[11] UplayDB, `UplayManifests` README. Describes the repository as a community-maintained collection of Ubisoft manifests and related product data. https://raw.githubusercontent.com/UplayDB/UplayManifests/main/README.md

[12] UplayDB, `UplayManifests/gamelist.json`. Public dataset keyed by Ubisoft product IDs and product types. https://raw.githubusercontent.com/UplayDB/UplayManifests/main/gamelist.json

[13] UplayDB, `UplayManifests/manifestlist.json`. Public dataset mapping product IDs to one or more manifest hashes. https://raw.githubusercontent.com/UplayDB/UplayManifests/main/manifestlist.json

[14] UplayDB, `UplayManifests/productservice.json`. Public dataset mapping product IDs to Ubisoft `SpaceId` and `AppId` values. https://raw.githubusercontent.com/UplayDB/UplayManifests/main/productservice.json

[15] UplayDB, `UplayManifests/productconfig.json`. Public dataset containing YAML-like product configuration blobs keyed by product ID. https://raw.githubusercontent.com/UplayDB/UplayManifests/main/productconfig.json

[16] mubaraknumann, `unifideck/py_modules/unifideck/stores/ubisoft_api.py`. A newer third-party client that documents `Ubi-Challenge` handling during direct login and current GraphQL pagination behavior; useful but lower-confidence than [1]-[15] until experimentally validated here. https://raw.githubusercontent.com/mubaraknumann/unifideck/1d20f9a11b704d5235419f7b1c617f6d081e7893/py_modules/unifideck/stores/ubisoft_api.py

[17] UplayDB, sample public manifest fixture `files/46_0C3D19B8681787293905C848F20553A0D21133C6.manifest`. Used as a reproducible parser fixture in this repo. https://raw.githubusercontent.com/UplayDB/UplayManifests/main/files/46_0C3D19B8681787293905C848F20553A0D21133C6.manifest

[18] UplayDB, sample public parsed manifest text `files/46_0C3D19B8681787293905C848F20553A0D21133C6.txt`. Used to sanity-check manifest parsing output for the fixture in [17]. https://raw.githubusercontent.com/UplayDB/UplayManifests/main/files/46_0C3D19B8681787293905C848F20553A0D21133C6.txt
