# Live devnet inspector

<div class="quorum-warning">Read-only inspection of a dedicated test deployment. Prices and allocation inputs are invented fixtures. No wallet connection, signing, backend price calls or automatic polling.</div>

<div id="devnet-inspector" class="quorum-inspector">
<p data-snapshot aria-live="polite">Loading the recorded verification snapshot…</p>
<p><a href="evidence/latest-devnet.json">Download the recorded public evidence JSON</a> · <a href="evidence/source.json">Snapshot provenance</a></p>
<form>
<label>Devnet HTTPS RPC URL <input name="rpc" type="url" value="https://api.devnet.solana.com" required autocomplete="off" spellcheck="false"></label>
<button type="submit">Read confirmed accounts</button>
</form>
<p data-status role="status" aria-live="polite">Press the button to verify the network and read on-chain accounts. Do not paste private credentials.</p>
<div data-output></div>
<noscript>Enable JavaScript for live reads. The rest of this handbook and downloaded verification evidence work without it.</noscript>
</div>

## What the reader checks

It verifies the devnet genesis hash before any account read. It requests SOL,
BTC and ETH price feeds plus `AllocationState` in one `getMultipleAccounts` call,
using the confirmed slot as a **lower bound**. It checks the account owner,
discriminator, feed identity, ring head, full byte length and ring/header agreement.
u64 fields remain exact `bigint` values. Prices use six decimal places.

Freshness is measured against the actual returned RPC context slot, with the lab's
four-window tolerance. `STALE`, `FUTURE`, `UNSET` and missing accounts are visible;
they are not presented as usable fresh prices. Allocation update slots are shown
without claiming a production allocation-freshness policy exists.

The test program is `DZGzK8wkxRWyhEorA8SSfPbUvHRAwog8vSsKeLEx4Coz`.
Its known feed addresses are pinned to that deployment, not a user-configurable
mainnet program. Venue indices have **no verified mapping** to the named lending
protocols in this handbook.

## Network errors

Browser CORS policies and public RPC limits can prevent reads. Errors are shown;
the frontend never substitutes a fixture snapshot for a failed live read. Wait
before retrying, or provide an HTTPS devnet RPC that permits your browser origin.
Private signing keys and privileged RPC credentials do not belong in this UI.
