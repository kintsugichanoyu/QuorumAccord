# 1. Three oracles. One allocation.

Every displayed transaction was fetched from real devnet RPC.

Live USDC supply APY from Marginfi, Save and Kamino, published by three independent signing processes. 3 / 3 sample quorum 4 observed allocations 203 fetched transactions 4 running containers 2026-10-10T12:27:31.708Z → 2026-10-10T12:36:41.151Z · mainnet reads / devnet writes

---

# 2. From protocol state to allocation

Implements specs/SPECIFICATION.md: producer → series consensus → ring buffer → consumer → allocation consensus → AllocationState.

MAINNET USDC × 3 venues → ORACLES 1 / 2 / 3 separate wallets → DEVNET FEEDS median · quorum 3 → CONSUMER integer rubric → ALLOCATION STATE 10000 bps All three oracles independently read all three protocols. Each signs one vote per venue and devnet slot window. The consumer reads finalized feed heads from chain. 240-slot sample windows. One consumer ⇒ allocation quorum 1. Agreement is proven; source independence and consumer decentralization are outside this demo.

---

# 3. Deploy and verify the main program

The upgrade transaction is new. Existing account bootstrap is reused, not represented as a new transaction.

DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz The existing devnet program was upgraded. Deployed bytecode was compared with the local SBF build, and upgrade authority was checked against the funding wallet. slot 509534320 deploy / upgrade main program 3AZWKwDDCbDURRiQcSPCch2kfW3qkHDpxWPWDtrYkKN2djkWmJoECymiwh7ofgKuU9Me3hFDQWdnJ7ER6BaSmvC6 [ { &quot;program&quot;: &quot;BPFLoaderUpgradeab1e11111111111111111111111&quot;, &quot;accounts&quot;: [ &quot;GeX9mtULBVsiDgtYwPcXL7WjMtFV9ZCEjuwYjhdrwuFN&quot;, &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;E5tKyJtozayh8QFRyVL3PHRgv3QnsCZo3ta4Lb86zt3m&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot;, &quot;SysvarRent111111111111111111111111111111111&quot;, &quot;SysvarC1ock11111111111111111111111111111111&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot; ], &quot;name&quot;: &quot;upgradeable_loader&quot;, &quot;data&quot;: { &quot;variant&quot;: 3 } } ] The registry and AllocationState already existed and were reused after identity and authority checks.

---

# 4. One funding wallet → three producers

Keys are generated once in ignored .state/keys with restrictive permissions. Funding uses the existing devnet wallet.

Role Public key Funding oracle-1 6mTM9YQcxGdkPmAzGCF25vCkdCpJqbjEYHxChvHfeTwH 0.25 devnet SOL oracle-2 7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf 0.25 devnet SOL oracle-3 FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L 0.25 devnet SOL Funding wallet: 2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc slot 509535891 fund oracle-1 from existing devnet wallet 5j8VkZ14dKg8xZEVpQ7Q4smW4na9RBQ9nnNqQcmkHZEfD32CYkLSCNLP4eXi1TbVjneXAz6vL7R123BezBb2zh1k [ { &quot;program&quot;: &quot;11111111111111111111111111111111&quot;, &quot;accounts&quot;: [ &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot;, &quot;6mTM9YQcxGdkPmAzGCF25vCkdCpJqbjEYHxChvHfeTwH&quot; ], &quot;name&quot;: &quot;system_transfer&quot;, &quot;data&quot;: { &quot;lamports&quot;: &quot;250000000&quot; } } ] slot 509535900 fund oracle-2 from existing devnet wallet 4X6sdupzCYrPJiaYoeNygmR4XRi4uUD9B9RRj32xGqChWhw6yJ8qcWbuDZEkAd4rRSin5ZdsYXLcLtguGNj9HTZb [ { &quot;program&quot;: &quot;11111111111111111111111111111111&quot;, &quot;accounts&quot;: [ &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot;, &quot;7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf&quot; ], &quot;name&quot;: &quot;system_transfer&quot;, &quot;data&quot;: { &quot;lamports&quot;: &quot;250000000&quot; } } ] slot 509535911 fund oracle-3 from existing devnet wallet 3RBGftDnSdPuxGo2anPhkUf4eRKd9CHnK4CWafHJ7aEJzjmoKu7AdnDXRmqSwhVkpsrcyjteEJz4F51EuyuywDNn [ { &quot;program&quot;: &quot;11111111111111111111111111111111&quot;, &quot;accounts&quot;: [ &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot;, &quot;FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L&quot; ], &quot;name&quot;: &quot;system_transfer&quot;, &quot;data&quot;: { &quot;lamports&quot;: &quot;250000000&quot; } } ]

---

# 5. Register every signing producer

Membership is checked on submission. The consumer uses the registry admin because only admin can open allocation rounds.

The admin registered the three new oracle keys. The devnet admin also signs the single consumer. slot 509535922 register 6mTM9YQcxGdkPmAzGCF25vCkdCpJqbjEYHxChvHfeTwH 4hCsf2LwFGxLLJieBMaSGihPDo911p5XAfHMeapPCLAfASC4XcUuvGkjRaXJnTG5fd4FuVVKmmjCLoWpRTXGCJpH [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot; ], &quot;name&quot;: &quot;add_operator&quot;, &quot;data&quot;: { &quot;operator&quot;: &quot;6mTM9YQcxGdkPmAzGCF25vCkdCpJqbjEYHxChvHfeTwH&quot; } } ] slot 509535932 register 7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf 3pZYk6HQwuK5iU5hpghHdUJS29FaZtRYakkWFpLwVmsLahPrV3p4pBUP1Kdk5JQkyuXwf3Xmrncx4fpZ5rQiT7TD [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot; ], &quot;name&quot;: &quot;add_operator&quot;, &quot;data&quot;: { &quot;operator&quot;: &quot;7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf&quot; } } ] slot 509535940 register FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L 4DavqzKvEJY4uUyq2LPSnxhXynoKLcw2CYohiLmiQkjq2R45juxTjsVf5kUb6znLVrjNJ5uZnrY7EokkTGHccJQD [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot; ], &quot;name&quot;: &quot;add_operator&quot;, &quot;data&quot;: { &quot;operator&quot;: &quot;FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L&quot; } } ] Decoded OperatorRegistry contains all three new keys. Existing registered test operators remain present.

---

# 6. The same asset on all three venues

Read-only mainnet RPC; the sources are real protocol accounts. Publication is a devnet demonstration.

Venue APY sample Verified account Marginfi 6.99% 2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB Save 1.64% BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw Kamino 4.51% D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59 Mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v Independent fetches verify mainnet genesis, account owner, mint, market and supported layout. Raw bytes and RPC context slots are retained. Base lending APY excludes token incentives. Kamino legacy reserves use the SDK nominal 500ms slot convention.

---

# 7. Three APY feeds, three votes required

The generic on-chain instruction set serves every venue; named SDK decoders run off chain.

Venue Pool / data Feed PDA Marginfi 80 / 0 A5XBGuLiiFmhn83BZXNz6kF5PR6vehVRDtaFvjq4mV65 Save 81 / 0 HXTs2z35oLW5DvUiyMuEnWo7yNXRDp3FYrG7oA22Jvtb Kamino 82 / 0 H2WGBKwRwRxagHUvsaCUTVPBAjPisC6L9JWDV1E5gsSp 1 bps = 0.01%. Median aggregation. Minimum and maximum interval = 240 slots. Ring capacity = 256 samples. slot 509535960 initialize Marginfi USDC supply APY feed 65E676L5jVENaim1vzuP9tRAuhLs6CMqkaBEBghkVDpbDPj9tBu5Eo9ruh8aLG2xSm5mqZ1g5KaTNxWc3Wdhu3LK [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;A5XBGuLiiFmhn83BZXNz6kF5PR6vehVRDtaFvjq4mV65&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot;, &quot;11111111111111111111111111111111&quot; ], &quot;name&quot;: &quot;init_data_feed&quot;, &quot;data&quot;: { &quot;pool_id&quot;: 80, &quot;data_id&quot;: 0, &quot;config&quot;: { &quot;measurand&quot;: 0, &quot;window_slots&quot;: 240, &quot;threshold_bps&quot;: 1, &quot;min_interval_slots&quot;: 240, &quot;max_interval_slots&quot;: 240, &quot;min_number&quot;: 3, &quot;rule&quot;: 1, &quot;trim_pct&quot;: 0 } } } ] slot 509535972 initialize Save USDC supply APY feed 44vbrYhDYpqPPX6vGLZ89pMhjZQ4G5Qkk7SomgYBgwC63zPXnAku96gKD52Rta7GwE5GtwcCNjhMz6QooWyg9Bp7 [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;HXTs2z35oLW5DvUiyMuEnWo7yNXRDp3FYrG7oA22Jvtb&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot;, &quot;11111111111111111111111111111111&quot; ], &quot;name&quot;: &quot;init_data_feed&quot;, &quot;data&quot;: { &quot;pool_id&quot;: 81, &quot;data_id&quot;: 0, &quot;config&quot;: { &quot;measurand&quot;: 0, &quot;window_slots&quot;: 240, &quot;threshold_bps&quot;: 1, &quot;min_interval_slots&quot;: 240, &quot;max_interval_slots&quot;: 240, &quot;min_number&quot;: 3, &quot;rule&quot;: 1, &quot;trim_pct&quot;: 0 } } } ] slot 509535978 initialize Kamino USDC supply APY feed 2YMqA3rargAYgsaukvWkqgyscGuwpQstCKDMy19w2XWhA8ComzcWiEbtPY9meyu5bUMPjsMbafYA2x8YeDcCcYvd [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;H2WGBKwRwRxagHUvsaCUTVPBAjPisC6L9JWDV1E5gsSp&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot;, &quot;11111111111111111111111111111111&quot; ], &quot;name&quot;: &quot;init_data_feed&quot;, &quot;data&quot;: { &quot;pool_id&quot;: 82, &quot;data_id&quot;: 0, &quot;config&quot;: { &quot;measurand&quot;: 0, &quot;window_slots&quot;: 240, &quot;threshold_bps&quot;: 1, &quot;min_interval_slots&quot;: 240, &quot;max_interval_slots&quot;: 240, &quot;min_number&quot;: 3, &quot;rule&quot;: 1, &quot;trim_pct&quot;: 0 } } } ]

---

# 8. Four isolated processes stay running

The consumer hosts a pacing proxy forwarding real devnet RPC; each producer reads mainnet independently.

Container Signer Status oracle-1 6mTM9YQcxGdkPmAzGCF25vCkdCpJqbjEYHxChvHfeTwH running / healthy oracle-2 7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf running / healthy oracle-3 FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L running / healthy consumer 2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc running / healthy Each producer receives only its own secret. The consumer receives the devnet admin secret. Services restart unless stopped and use read-only filesystems apart from mounted journals. sudo docker compose -f deployment/devnet/compose.yaml ps

---

# 9. Decode the three signed votes

The finalized account has count 3, quorum 3 and status 2. It is archived before rent reclamation.

Window 2123087 · closes at 509541120 · finalized · votes 3 / 3 · median 452 bps Signing operator Submitted APY (bps) FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L 452 7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf 452 6mTM9YQcxGdkPmAzGCF25vCkdCpJqbjEYHxChvHfeTwH 452 R7ejTyc5gwVFooSBpxi9GcYogdCb4d4vTJzi3t955tn slot 509540912 propose_sample / corroborate_sample USDC venues window=2123087 3SEM2FxmhLJs9SCzcTG6TWZmYbJoLbfqMwVqJahmGN626oZf98SMVvigE2mqJ4EgtX42nxBW6bWoJsfydy2qzTuJ [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;A5XBGuLiiFmhn83BZXNz6kF5PR6vehVRDtaFvjq4mV65&quot;, &quot;3ZYTKkWt5xwDuc6BgWNwxbENuzDQsKGcPyN44qdfoVzY&quot;, &quot;FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L&quot;, &quot;11111111111111111111111111111111&quot; ], &quot;name&quot;: &quot;propose_sample&quot;, &quot;data&quot;: { &quot;window_index&quot;: &quot;2123087&quot;, &quot;value&quot;: &quot;699&quot;, &quot;slot_at_read&quot;: &quot;509540905&quot; } }, { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;HXTs2z35oLW5DvUiyMuEnWo7yNXRDp3FYrG7oA22Jvtb&quot;, &quot;9kCRfnJQZo6xFWKT6xYB1Ftk2hnQ4F19kT9bHfCzSo5p&quot;, &quot;FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L&quot;, &quot;11111111111111111111111111111111&quot; ], &quot;name&quot;: &quot;propose_sample&quot;, &quot;data&quot;: { &quot;window_index&quot;: &quot;2123087&quot;, &quot;value&quot;: &quot;164&quot;, &quot;slot_at_read&quot;: &quot;509540905&quot; } }, { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;H2WGBKwRwRxagHUvsaCUTVPBAjPisC6L9JWDV1E5gsSp&quot;, &quot;R7ejTyc5gwVFooSBpxi9GcYogdCb4d4vTJzi3t955tn&quot;, &quot;FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L&quot;, &quot;11111111111111111111111111111111&quot; ], &quot;name&quot;: &quot;propose_sample&quot;, &quot;data&quot;: { &quot;window_index&quot;: &quot;2123087&quot;, &quot;value&quot;: &quot;452&quot;, &quot;slot_at_read&quot;: &quot;509540905&quot; } } ] slot 509540968 propose_sample / corroborate_sample USDC venues window=2123087 5Hgiq3Jfp75s1T5r7yAbp1EcbULiwmG9BP4ac12rJ6MMNfYADrRDpYEUkS7rkkbZfVHvN9yzHhqvha3v6wQt3JbQ [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;A5XBGuLiiFmhn83BZXNz6kF5PR6vehVRDtaFvjq4mV65&quot;, &quot;3ZYTKkWt5xwDuc6BgWNwxbENuzDQsKGcPyN44qdfoVzY&quot;, &quot;7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf&quot; ], &quot;name&quot;: &quot;corroborate_sample&quot;, &quot;data&quot;: { &quot;window_index&quot;: &quot;2123087&quot;, &quot;value&quot;: &quot;699&quot;, &quot;slot_at_read&quot;: &quot;509540917&quot; } }, { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;HXTs2z35oLW5DvUiyMuEnWo7yNXRDp3FYrG7oA22Jvtb&quot;, &quot;9kCRfnJQZo6xFWKT6xYB1Ftk2hnQ4F19kT9bHfCzSo5p&quot;, &quot;7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf&quot; ], &quot;name&quot;: &quot;corroborate_sample&quot;, &quot;data&quot;: { &quot;window_index&quot;: &quot;2123087&quot;, &quot;value&quot;: &quot;164&quot;, &quot;slot_at_read&quot;: &quot;509540917&quot; } }, { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;H2WGBKwRwRxagHUvsaCUTVPBAjPisC6L9JWDV1E5gsSp&quot;, &quot;R7ejTyc5gwVFooSBpxi9GcYogdCb4d4vTJzi3t955tn&quot;, &quot;7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf&quot; ], &quot;name&quot;: &quot;corroborate_sample&quot;, &quot;data&quot;: { &quot;window_index&quot;: &quot;2123087&quot;, &quot;value&quot;: &quot;452&quot;, &quot;slot_at_read&quot;: &quot;509540917&quot; } } ] The observer re-decodes archived bytes, verifies the three submitters and recomputes the median.

---

# 10. Yield → normalize → cap

All thirteen unused venue positions remain zero. Source measurements and configured risk/cap policy are distinguished.

Venue Input APY bps Risk Cap Weight Marginfi 699 0 bps 50% 50.00% Save 164 0 bps 50% 14.70% Kamino 452 0 bps 50% 35.30% Integer arithmetic; largest-remainder rounding; cap redistribution proportional to available headroom. The demo JS calculation was checked against the production Rust rubric. Risk discount = 0 is a neutral demonstration policy, not a protocol risk assessment.

---

# 11. Open, submit, finalize on chain

The fleet consumer handles repeated rounds, duplicate avoidance and persisted lifecycle recovery.

slot 509539012 open allocation 509539005 quorum=1 3akvoLNC4LQT1Y8m9ToodbZG4geTfC5ajVmh8YkBBixAdowTced8rtzSQhUGB4KvJCwHBNAqGJQ2HHs7cDvwzfN2 [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;7kKAGHd1cS7Wak9aMpKgKpbPNxVs1fQKDuqYD65oyXUw&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot;, &quot;11111111111111111111111111111111&quot; ], &quot;name&quot;: &quot;open_allocation_round&quot;, &quot;data&quot;: { &quot;round&quot;: &quot;509539005&quot;, &quot;closes_at_slot&quot;: &quot;509539085&quot;, &quot;min_number&quot;: 1, &quot;rule&quot;: 1, &quot;trim_pct&quot;: 0 } } ] slot 509539020 submit allocation 509539005 QcaAPddUsXN4gasqjZwPAPJAtdeHcp7ZhS1Ns3BxXwxBRnuGK7h87VgDxDEccHas2iiwacRduyZ7hTpUGLRNUnW [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;8gqgUdLzwjcJViRZCc3u2SFBQxbmb2HdGaQZHw82wiqG&quot;, &quot;7kKAGHd1cS7Wak9aMpKgKpbPNxVs1fQKDuqYD65oyXUw&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot; ], &quot;name&quot;: &quot;submit_weights&quot;, &quot;data&quot;: { &quot;round&quot;: &quot;509539005&quot;, &quot;weights&quot;: [ 5000, 1474, 3526, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ] } } ] slot 509539116 finalize allocation 509539005 3z8zSz2AS2dmdNQEB9GTvy1ozBKyZ8aJP6dZ1TKaty1keHHfhaFUGeEDkiAqTpNZa67EWqrAHKpaLwoFg8G7Si6x [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;7kKAGHd1cS7Wak9aMpKgKpbPNxVs1fQKDuqYD65oyXUw&quot;, &quot;Fxm3c6cfmHb3taPdqVcka6USRAHkytZn3zyBUAwPbS8S&quot;, &quot;2rH2YbtCjFxNV4JL6JC1AQixxxviBEmMk8aBYBABoukc&quot; ], &quot;name&quot;: &quot;finalize_allocation&quot;, &quot;data&quot;: { &quot;round&quot;: &quot;509539005&quot; } } ] The consumer starts a fresh round when all three feed heads advance together, waits for the closing slot, and finalizes the weights.

---

# 12. AllocationState advances over time

AllocationState: round at offset 8, updated_slot at 16, sixteen little-endian u16 weights at 24.

Fxm3c6cfmHb3taPdqVcka6USRAHkytZn3zyBUAwPbS8S 15 snapshots over 240 seconds; 4 allocations published during observation. { &quot;round&quot;: &quot;509541197&quot;, &quot;updated_slot&quot;: &quot;509541307&quot;, &quot;weights&quot;: [ 5000, 1470, 3530, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ] }

---

# 13. Archive proof, then return rent

Sample rent returns only to the original payer; allocation rent returns only to the registry admin. Layouts and PDA seeds are preserved.

slot 509536852 reclaim Save sample rent 2123069 5ForkM8WXant49sVojYktsKdpq6aTPYv1pdq8hi3gdRYhwKNhNHMQqHexoqKwRW5bAmt2vSeQRfr5dJbL32xgoFv [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;HXTs2z35oLW5DvUiyMuEnWo7yNXRDp3FYrG7oA22Jvtb&quot;, &quot;3nhG7dQ8zd6k8fgUrvsrDvTdDkk16tXDKSJKkuqmdQAk&quot;, &quot;FLj3KsBGXCh9uM7PY3ttKz13MpLvrj98i2qWY8daaa6L&quot; ], &quot;name&quot;: &quot;close_sample_consensus&quot;, &quot;data&quot;: { &quot;window_index&quot;: &quot;2123069&quot; } } ] slot 509536864 reclaim Kamino sample rent 2123069 4qYbFU8d6GNzUDSFBY43biN5id5Zpe8q1k9nTEqACPj9HtTVMSoS2GoKD9qGjMc5sGm5Y6oNuXJtLemTeHmvLHVc [ { &quot;program&quot;: &quot;DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz&quot;, &quot;accounts&quot;: [ &quot;H2WGBKwRwRxagHUvsaCUTVPBAjPisC6L9JWDV1E5gsSp&quot;, &quot;HWiBnG6z9pCB7CvXc6YbKzWuUZdbUn6zwV4jYyQhGE8Q&quot;, &quot;7tx3XxRt1u1bfsiwrjpaJ59hbr483Fvw1YiRmvs7ohZf&quot; ], &quot;name&quot;: &quot;close_sample_consensus&quot;, &quot;data&quot;: { &quot;window_index&quot;: &quot;2123069&quot; } } ] Persistent ring buffers and AllocationState remain on chain. Completed consensus bytes are archived before closing. Submissions and finalization instructions remain verifiable in fetched transactions. Devnet checks rejected open-account closure and unauthorized rent reclamation. The allocation closure test returned rent minus its transaction fee.

---

# 14. Verified and still running

The fleet remains running with restart-unless-stopped. Reclaimed rent prevents repeated consensus account creation from consuming the starting balances.

Marginfi 50.00% Save 14.70% Kamino 35.30% Weights sum to 100%. The three oracles and consumer were verified running and healthy after observation. 34 finalized venue windows verified; 203 confirmed transactions fetched and decoded. Devnet fee funding is finite. This system publishes allocation signals; it does not move capital.

---

# 15. Reproduce and inspect every step

Artifacts contain public keys and on-chain bytes only. Secrets remain in ignored state directories.

./scripts/devnet/deploy-system.sh Outcome Raw + decoded PDAs Fetched + decoded transactions Sources + consensus archives SHA-256 manifest Official SDKs: Marginfi · Save · Kamino Static neutral risk discount (0 bps) and 50% per-venue caps are an explicit demo policy. Base supply interest APY excludes token incentive emissions. The single consumer uses the devnet registry admin to open rounds; producer containers only receive their own key. Samples attest agreement by three operators using the same public mainnet RPC; this is not source decentralization. Latest feed reads have an RPC context lower bound; historical input commitments are not implemented.
