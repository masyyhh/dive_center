#!/usr/bin/env python3
"""Install a commit-pinned manual release with Disclaimer/rentals disabled."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys


RENTAL_TABLES = ['EquipmentStock', 'EquipmentRental', 'EquipmentRentalLine', 'RentalAgreement', 'RentalEvent']
TRIP_TABLES = ['TankCommissionSettings', 'TankResource', 'TankCommissionRule', 'dive_trips', 'trip_crew_assignments', 'dive_trip_sites']


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Release template changed; inspect it before installing: ' + old[:80])
    return text.replace(old, new, 1)


def render(source, commit, trips_start_date=None):
    if not re.fullmatch('[a-f0-9]{40}', commit):
        raise ValueError('A full commit SHA is required.')
    if trips_start_date is not None and trips_start_date != '2026-11-01':
        raise ValueError('This release supports a Trips start date of 2026-11-01 only.')
    release = commit[:12]
    release_tables = RENTAL_TABLES + (TRIP_TABLES if trips_start_date else [])
    fingerprint = (source / 'scripts/production-data-fingerprint.cjs').read_text()
    fingerprint = replace_once(fingerprint,
        "const addedCreditTables = ['BillItemInstructor', 'BillItemPhotoStaff'];",
        "const addedCreditTables = ['BillItemInstructor', 'BillItemPhotoStaff', " + ', '.join(repr(t) for t in release_tables) + '];')
    # New rental tables are permitted only when present and empty; old table
    # values (including existing rental records) retain the original hash check.
    fingerprint = replace_once(fingerprint, '  const tables = {};',
        '  if (baseline) {\n'
        '    for (const table of ' + repr(release_tables) + ') {\n'
        "      if (!actual[table]) throw Error('Missing rental table: ' + table);\n"
        '      if (!original[table]) {\n'
        '        const [row] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::text AS count FROM ${quote(schema)}.${quote(table)}`);\n'
        "        if (row.count !== '0') throw Error('New rental table must be empty: ' + table);\n"
        '      }\n'
        '    }\n'
        '  }\n'
        '  const tables = {};')
    digest = hashlib.sha256(fingerprint.encode()).hexdigest()
    helper = (source / 'scripts/release-production-0ce1e232.sh').read_text()
    helper = replace_once(helper, 'commit=0ce1e2329192e0b31d2d8613de1794f69b0c3dea', 'commit=' + commit)
    helper = helper.replace('0ce1e232', release)
    helper = replace_once(helper,
        'd7f9aa245d27addea950e13c77db900fcdc8e45fb234c7099c4ae156227edafa', digest)
    helper = replace_once(helper, '--build-arg "VITE_ENABLE_WATER_SPORTS=$feature"', '--build-arg VITE_ENABLE_WATER_SPORTS=false')
    helper = replace_once(helper,
        "flags={'APP_DEPLOYMENT_MODE':'live','DISCLAIMER_TEST_GUESTS':'false','TESTING_LIVE_AUTH':'false'}",
        "flags={'APP_DEPLOYMENT_MODE':'live','DISCLAIMER_TEST_GUESTS':'false','TESTING_LIVE_AUTH':'false','ENABLE_DIVE_CENTRE':'false','ENABLE_WATER_SPORTS':'false'}")
    helper = replace_once(helper,
        '-e NODE_ENV=production -e TESTING_LIVE_AUTH=false -e APP_DEPLOYMENT_MODE=live -e DISCLAIMER_TEST_GUESTS=false',
        '-e NODE_ENV=production -e TESTING_LIVE_AUTH=false -e APP_DEPLOYMENT_MODE=live -e DISCLAIMER_TEST_GUESTS=false -e ENABLE_DIVE_CENTRE=false -e ENABLE_WATER_SPORTS=false')
    helper = replace_once(helper,
        'if(process.env.APP_DEPLOYMENT_MODE!=="live"||process.env.DISCLAIMER_TEST_GUESTS!=="false"||process.env.TESTING_LIVE_AUTH!=="false")process.exit(1)',
        'if(process.env.APP_DEPLOYMENT_MODE!=="live"||process.env.DISCLAIMER_TEST_GUESTS!=="false"||process.env.TESTING_LIVE_AUTH!=="false"||process.env.ENABLE_DIVE_CENTRE!=="false"||process.env.ENABLE_WATER_SPORTS!=="false")process.exit(1)')
    if trips_start_date:
        helper = replace_once(helper, '--build-arg VITE_ENABLE_WATER_SPORTS=false',
            '--build-arg VITE_ENABLE_WATER_SPORTS=false --build-arg VITE_TRIPS_ENABLED=true')
        helper = replace_once(helper,
            "'ENABLE_DIVE_CENTRE':'false','ENABLE_WATER_SPORTS':'false'}",
            "'ENABLE_DIVE_CENTRE':'false','ENABLE_WATER_SPORTS':'false','TRIPS_ENABLED':'true','TRIPS_START_DATE':'" + trips_start_date + "'}")
        helper = replace_once(helper,
            '-e ENABLE_DIVE_CENTRE=false -e ENABLE_WATER_SPORTS=false',
            '-e ENABLE_DIVE_CENTRE=false -e ENABLE_WATER_SPORTS=false -e TRIPS_ENABLED=true -e TRIPS_START_DATE=' + trips_start_date)
        helper = replace_once(helper,
            '||process.env.ENABLE_WATER_SPORTS!=="false")process.exit(1)',
            '||process.env.ENABLE_WATER_SPORTS!=="false"||process.env.TRIPS_ENABLED!=="true"||process.env.TRIPS_START_DATE!=="' + trips_start_date + '")process.exit(1)')
    return release, helper, fingerprint


def main():
    if os.geteuid() != 0:
        raise ValueError('Run with sudo on production.')
    source = Path(sys.argv[1]).resolve()
    git = ['git', '-c', 'safe.directory=' + str(source), '-C', str(source)]
    commit = subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True).strip()
    if subprocess.check_output(git + ['status', '--porcelain', '--untracked-files=normal', '--', 'backend', 'frontend', 'scripts'], text=True).strip():
        raise ValueError('Commit all release source changes before installation.')
    trips_start_date = sys.argv[2] if len(sys.argv) > 2 else None
    release, helper, fingerprint = render(source, commit, trips_start_date)
    subprocess.run(['bash', '-n'], input=helper, text=True, check=True)
    directory = Path('/usr/local/lib/dive-production-' + release)
    script = Path('/usr/local/sbin/dive-production-' + release)
    outputs = [(directory / 'fingerprint.cjs', fingerprint, 0o444), (script, helper, 0o700)]
    for path, content, _ in outputs:
        if path.exists() and (path.is_symlink() or path.read_text() != content):
            raise ValueError('Existing release tool differs: ' + str(path))
    if directory.is_symlink():
        raise ValueError('Release directory must not be a symlink.')
    directory.mkdir(mode=0o700, exist_ok=True)
    for path, content, mode in outputs:
        if not path.exists():
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
            with os.fdopen(descriptor, 'w') as stream:
                stream.write(content)
        os.chmod(path, mode)
    print('Commit: ' + commit)
    print('Release: ' + release)
    print('Helper: ' + str(script))
    print('Disclaimer and Equipment rentals will be disabled in production.')
    if trips_start_date:
        print('Trips & Tanks entries and commissions start on ' + trips_start_date + '.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, IndexError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
