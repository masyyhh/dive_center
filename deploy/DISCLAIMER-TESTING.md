# Disclaimer practice workflow

The standalone testing deployment can exercise real session creation, document
selection, signatures and signed records using fictional guests. It requires a
working **testing** application database; PMS access is not required.

Enable only on `/srv/dive-centre-testing-independent` at `192.168.130.3`:

```sh
DISCLAIMER_TEST_GUESTS=true bash deploy-testing-update.sh /path/to/release.tar.gz
```

The scoped updater builds the frontend with Disclaimer enabled and configures the
backend with `APP_DEPLOYMENT_MODE=testing`, `DISCLAIMER_TEST_GUESTS=true`, and
`ENABLE_WATER_SPORTS=true`. It preserves the independent testing database, normal
login and existing authenticator keys. This option has no production deployment
counterpart.

The server refuses to start fictional guest mode unless the datasource host is
`db`, both database and role are `dive_center_testing`, live authentication is
explicitly disabled and the PMS API key is empty. `NODE_ENV=production` remains
correct for the hardened testing container; deployment mode is a separate check.
The database URL and feature settings are server configuration, never request
parameters. Ordinary billing/PMS guest lookup is unchanged.

## Practice checks

1. Sign in at `https://diving-staging.ssrsys.com` and choose a property.
2. Open **Disclaimer**. Confirm the fictional-guests notice is visible.
3. Prepare a participation form for room **0012**. Open its private guest link.
4. Enter **0012**, select one of the two `TEST ONLY` guests, choose a language,
   acknowledge the document and use a practice signature.
5. Confirm a running number appears. Reload/retry: it must remain the same record.
6. Find the record under **Signed records**. Check guest, room, departure date,
   signature and document snapshot.
7. Repeat for **0013**, choosing the parent/guardian option. A guardian name must
   be required. The child fixture does not infer age; explicitly choose this option.
8. Room **0014** (and all other unlisted rooms) returns no guests. **12** must not
   resolve room **0012**.
9. Cancel a prepared link, or let it expire after 20 minutes, and verify it is rejected.
10. Test equipment forms with required equipment fields. Test another property to
    confirm records remain scoped to their property.

These checks prove the form and persistence workflow, not the real PMS integration.
All practice records remain in the testing database. Fictional names and booking
references mark them as test data. Do not enter real guest details or signatures.

To disable fictional lookup, set `DISCLAIMER_TEST_GUESTS=false` in the testing
backend environment and recreate only that backend. With an empty PMS key,
Disclaimer guest lookup then reports PMS is not configured. There is no automatic
fallback to fictional identities if a real PMS request fails.
