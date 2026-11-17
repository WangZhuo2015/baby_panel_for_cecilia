#!/usr/bin/env python3
"""Exercise the ledger upgrade against an exclusively owned in-memory SQLite DB."""
from pathlib import Path
import sqlite3


def main():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript('''
        PRAGMA foreign_keys=ON;
        CREATE TABLE "Baby" (id TEXT PRIMARY KEY);
        CREATE TABLE "Vaccine" (vaccineId TEXT PRIMARY KEY, name TEXT NOT NULL, shortName TEXT);
        CREATE TABLE "VaccineRecord" (
            id TEXT PRIMARY KEY, babyId TEXT NOT NULL, name TEXT NOT NULL,
            dose TEXT NOT NULL, scheduledDate TEXT NOT NULL,
            completedDate TEXT, isCompleted BOOLEAN NOT NULL DEFAULT false,
            FOREIGN KEY (babyId) REFERENCES Baby(id) ON DELETE CASCADE
        );
        INSERT INTO "Baby" VALUES ('test_baby_migration');
        INSERT INTO "Vaccine" VALUES ('test_product', 'test_完整产品名称', 'test_简称');
        INSERT INTO "Vaccine" VALUES ('test_hib_brand', 'test_Hib具体品牌', 'Hib');
    ''')
    fixtures = [
        ('test_done', 'test_baby_migration', 'test_完整产品名称', '第 2 剂', '2024-06-01', '2024-06-03', 1),
        ('test_plan', 'test_baby_migration', 'test_完整产品名称', '3', '2024-07-01', None, 0),
        ('test_uncertain', 'test_baby_migration', 'Hib', '批号 TEST-1234', '', None, 0),
        ('test_missing_actual', 'test_baby_migration', 'test_原文', '', '2024-08-01', None, 1),
    ]
    db.executemany('INSERT INTO "VaccineRecord" VALUES (?,?,?,?,?,?,?)', fixtures)
    db.commit()
    root = Path(__file__).resolve().parents[2]
    migration = root / 'prisma/migrations/20261114120000_vaccine_record_ledger/migration.sql'
    db.executescript(migration.read_text())
    rows = {row['id']: row for row in db.execute('SELECT * FROM "VaccineRecord"')}
    assert len(rows) == len(fixtures), 'migration must preserve all historical rows'
    done = rows['test_done']
    assert (done['scheduledDate'], done['completedDate'], done['administeredDate']) == ('2024-06-01', '2024-06-03', '2024-06-03')
    assert (done['vaccineId'], done['doseNumber'], done['dose'], done['recordStatus']) == ('test_product', 2, '第 2 剂', 'completed')
    plan = rows['test_plan']
    assert (plan['scheduledDate'], plan['administeredDate'], plan['doseNumber'], plan['recordStatus']) == ('2024-07-01', None, 3, 'planned')
    uncertain = rows['test_uncertain']
    assert uncertain['name'] == 'Hib' and uncertain['dose'] == '批号 TEST-1234'
    assert uncertain['vaccineId'] is None and uncertain['doseNumber'] is None
    assert uncertain['scheduledDate'] is None and uncertain['administeredDate'] is None
    assert uncertain['recordStatus'] == 'needs_review'
    missing = rows['test_missing_actual']
    assert missing['recordStatus'] == 'needs_review' and missing['administeredDate'] is None
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    db.close()
    print('PASS: 4 synthetic legacy records preserve dates, raw text, exact identities, unknown values and foreign keys')


if __name__ == '__main__':
    main()
