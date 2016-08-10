'use strict';

const app = require('express')();
const _ = require('lodash');
const axios = require('axios');
const async = require('async');
const sqlite3 = require('sqlite3');

const db = new sqlite3.Database('./ref.db');
const updateInterval = 5 * 60 * 1000; // 5 minutes
const countries = require('./countries');
const api_url = 'http://wowappprd.rio2016.com';
const feed_url = `${api_url}/json/medals/OG2016_medalsList.json`;
const medals_for_country = `${api_url}/countries/countriesMedals?lang_code=ENG&os_kind=ANDROID&competition_code=OG2016&noc_code=`;

// In memory cache
let cachedResponse = {};

function update(callback) {
    axios.get(feed_url).then(response => {
        let medalsList = _.result(response, 'data.body.medalRank.medalsList');
        if (!medalsList) return callback('No medals in the response');

        let medals = countries.map(country => {
            let countryMedals = _.find(medalsList, {noc_code: country.noc}) || {};
            return {
                flag: country.flag,
                noc: country.noc,
                name: country.name,
                bronze: parseInt(countryMedals.me_bronze || "0"),
                silver: parseInt(countryMedals.me_silver || "0"),
                gold: parseInt(countryMedals.me_gold || "0"),
                total: parseInt(countryMedals.me_tot || "0")
            };
        });
        medals = _.orderBy(medals, ['total'], ['desc']);

        cachedResponse = {
            lastUpdated: new Date().toISOString(),
            totalCountries: medals.length,
            medals: medals
        };

        callback();
    }, err => callback(err));
}


function updateTiming() {
    update(err => {
        // Randomize the scraping time a bit
        let nextUpdateTimeout = Math.round((Math.random() * 10000) + updateInterval);
        if (err) {
            console.log(err);
            nextUpdateTimeout = nextUpdateTimeout / 2;
        }
        if (nextUpdateTimeout < 10000) nextUpdateTimeout = 10000;
        console.log(`next call in ${nextUpdateTimeout}ms`);
        cachedResponse.nextUpdate = new Date(Date.now() + nextUpdateTimeout).toISOString();
        setTimeout(updateTiming, nextUpdateTimeout);
    });
}
updateTiming();

app.get('/', (req, res) => res.send('Hi there!'));
app.get('/countries', (req, res) => res.json(countries));
app.get('/medals', (req, res) => res.json(cachedResponse));
app.get('/medals/:NOC', (req, res, next) => {
    let NOC = (req.params.NOC || '').toUpperCase();
    if (!_.find(countries, {noc: req.params.NOC})) return next('Invalid NOC code');

    axios.get(medals_for_country + NOC).then(response => {
        let result = _.result(response, 'data.body.countriesMedals');
        if (!result) return next('Empty response from rio2016 API');
        result = _.flatten([result.bronzeList, result.goldList, result.silverList]);

        async.parallel({
            atheletes: (callback) => {
                let ids = _.uniq(_.map(_.filter(result, {competitor_type: 'A'}), 'competitor_code'));
                if (ids.length === 0) return callback(null, []);
                let query = `SELECT DISTINCT
                    ATHLETE_CODE as id,
                    TV_NAME as name,
                    NOC_CODE as noc,
                    GENDER_CODE as gender
                    FROM ATHLETE
                    WHERE ` + ids.map(id => `id = "${id}"`).join(' OR ');
                db.all(query, callback);
            },
            teams: (callback) => {
                let ids = _.uniq(_.map(_.filter(result, {competitor_type: 'T'}), 'competitor_code'));
                if (ids.length === 0) return callback(null, []);
                let query = `SELECT DISTINCT
                    TEAM.TEAM_CODE as id,
                    TEAM.TEAM_NAME as name,
                    TEAM.GENDER_CODE as gender,
                    DISCIPLINE.DISCIPLINE_CODE as discipline_code,
                    DISCIPLINE.ENG_DISCIPLINE_DESC as discipline
                    FROM TEAM
                    INNER JOIN DISCIPLINE ON TEAM.DISCIPLINE_CODE = DISCIPLINE.DISCIPLINE_CODE
                    WHERE ` + ids.map(id => `TEAM_CODE = "${id}"`).join(' OR ');
                db.all(query, callback);
            },
            documents: (callback) => {
                let ids = _.uniq(_.map(result, 'document_code'));
                if (ids.length === 0) return callback(null, []);
                let query = `SELECT
                    DOCUMENT_CODE as id,
                    ENG_UNIT_LONG_DESC as name,
                    DISCIPLINE.DISCIPLINE_CODE as discipline_code,
                    DISCIPLINE.ENG_DISCIPLINE_DESC as discipline
                    FROM DT_CODES
                    INNER JOIN DISCIPLINE ON DT_CODES.DISCIPLINE_CODE = DISCIPLINE.DISCIPLINE_CODE
                    WHERE ` + ids.map(id => `DOCUMENT_CODE = "${id}"`).join(' OR ');
                db.all(query, callback);
            }
        }, (err, results) => {
            if (err) return next(err);
            console.log(results.atheletes.length);
            console.log(results.atheletes);
            // Normalize the results
            result.forEach(entry => {
                entry.event = _.clone(_.find(results.documents, {id: entry.document_code})) || {name: 'unknown'};
                delete entry.event.id;

                if (entry.competitor_type == 'A') {
                    console.log(entry.competitor_code);
                    entry.athelete = _.clone(_.find(results.atheletes, {id: entry.competitor_code})) || {name: 'unknown'};
                    delete entry.athelete.id;
                } else if (entry.competitor_type == 'T') {
                    entry.team = _.clone(_.find(results.teams, {id: entry.competitor_code})) || {name: 'unknown'};
                    delete entry.team.id;
                }

                // medal type
                entry.medal = entry.medal_code.replace('ME_', '');

                // Remove redundant data
                delete entry.medal_code;
                delete entry.document_code;
                delete entry.competitor_code;
            });

            res.json(result);
        });

    }, err => next(err));
});

app.use((err, req, res, next) => res.status(400).json(err));

// Express app listen
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`App listening on port ${port}`));