'use strict';

/**
 * This script is used to parse and populate the DT_CODES
 * available at: http://odf.olympictech.org/2016-Rio/rio_2016_OG.htm
 *
 * The zip file "ODF DT_CODES Messages" contains the
 * file "DT_CODES_EVENT_UNIT.xml" that holds the dictionary for document_code values
 */
const fs = require('fs');
const _ = require('lodash');
const sqlite3 = require('sqlite3').verbose();
const xml2js = require('xml2js');

const TABLE_NAME = `DT_CODES`;

var parser = new xml2js.Parser();
fs.readFile(__dirname + '/DT_CODES_EVENT_UNIT.xml', (err, data) => {
    if (err) return console.error(err);
    parser.parseString(data, (err, result) => {
        if (err) return console.error(err);

        let codes = _.result(result, 'OdfBody.Competition[0].CodeSet');
        if (!codes) return console.error('No CodeSets in provided XML');

        let rows = codes.map(code => {
            let values = [
                code.$.Code, //DOCUMENT_CODE
                code.$.Discipline, //DISCIPLINE_CODE
                code.Language[0].$.Description, //ENG_UNIT_SHORT_DESC
                code.Language[0].$.LongDescription //ENG_UNIT_LONG_DESC
            ];
            return `(${values.map(val => `"${val}"`).join(',')})`;
        });

        let query = `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
            DOCUMENT_CODE         VARCHAR(9)    NOT NULL,
            DISCIPLINE_CODE       VARCHAR(2)    NOT NULL,
            ENG_UNIT_SHORT_DESC   VARCHAR(50)   NULL,
            ENG_UNIT_LONG_DESC    VARCHAR(100)  NULL
        );
        
        DELETE FROM ${TABLE_NAME};
        
        INSERT INTO ${TABLE_NAME} VALUES ${rows.join(', ')};`;

        let db = new sqlite3.Database('./ref.db');
        console.log(`Executing query, total rows: ${rows.length}`);
        db.exec(query, err => {
            if (err) return console.error(err);
            console.log('Done');
        });
    });
});