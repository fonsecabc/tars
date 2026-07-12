# Connecting C6 (via Pluggy / Open Finance) — one-time setup

You picked **Pluggy**. This is the only path that lets an individual read their own
C6 data programmatically: no one can call C6's API directly, and Open Finance Brasil
only exposes data to regulated participants — so we consent through Pluggy, a
regulated aggregator with a **free consumer tier** (`meu.pluggy.ai`) that supports C6
(accounts, transactions, credit cards, investments).

The code is already built (`finance/tars_finance/pluggy.py`, `tars-fin bank`). It just
needs three credentials from you. Until then, the invest routine falls back to
holdings recorded in the brain, and everything else runs normally.

## Steps (≈15 minutes, once)

1. **Create a Pluggy developer account** at https://dashboard.pluggy.ai — you get a
   `CLIENT_ID` and `CLIENT_SECRET`. (Free trial; per Pluggy's own `meu-pluggy` repo,
   read access to your own connected accounts continues after the trial window.)

2. **Connect C6 via the consumer wallet** at https://meu.pluggy.ai:
   - Sign in, choose "connect a bank", pick **C6 Bank**.
   - Complete the **Open Finance consent** (CPF + approve the share in the C6 app).
   - This creates a connected **item**; note its **`itemId`**.
   *(Alternatively, connect C6 straight from the dashboard using the Pluggy Connect
   widget and grab the `itemId` from there.)*

3. **Put the three values in `finance/.env`:**
   ```
   PLUGGY_CLIENT_ID=...
   PLUGGY_CLIENT_SECRET=...
   PLUGGY_ITEM_ID=...
   ```

4. **Verify:**
   ```sh
   cd "/Users/you/Projects/personal /tars/finance"
   export PATH="$HOME/.local/bin:$PATH"
   uv run tars-fin bank --write state/holdings.json
   ```
   You should see your C6 accounts + investments, bucketed, and a `holdings.json`
   written for the `tars-invest` routine to consume.

## Notes & honesty
- **Refresh is not real-time.** Open Finance syncs periodically, and the consent needs
  re-authorising roughly every 12 months.
- **The free path is a consumer product used for dev access** — tolerated, not
  contractually guaranteed forever. If it ever stops, the always-works fallback is a
  **manual OFX/CSV export** from C6 web banking (Extrato → Baixar, up to 180 days),
  parsed locally. We can wire that importer if needed.
- **Privacy:** balances stay on your Mac (local brain + local files). Nothing is sent
  anywhere except to Pluggy itself, which is the data source.
- **Bucket mapping** in `pluggy.py` is best-effort by account name/subtype; eyeball the
  first `bank` output and tell me if anything lands in the wrong bucket.
