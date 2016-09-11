var ERR = require('async-stacktrace');
var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var favicon = require('serve-favicon');
var async = require('async');
var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var https = require('https');

var logger = require('./logger');
var error = require('./error');
var config = require('./config');
var sqldb = require('./sqldb');
var syncFromDisk = require('./sync/syncFromDisk');
var syncFromMongo = require('./sync/syncFromMongo');

logger.infoOverride('PrairieLearn server start');

configFilename = 'config.json';
if (process.argv.length > 2) {
    configFilename = process.argv[2];
}

config.loadConfig(configFilename);

if (config.logFilename) {
    logger.addFileLogging(config.logFilename);
    logger.info('activated file logging: ' + config.logFilename);
}

var app = express();
app.set('views', __dirname);
app.set('view engine', 'ejs');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware for all requests
app.use(require('./middlewares/cors'));
app.use(require('./middlewares/auth'));
app.use(require('./middlewares/mode'));
app.use(require('./middlewares/logRequest'));
app.use(require('./middlewares/parsePostData'));

/*
  For each route we do several things:
  1. Check authorization.
  2. Check that the implied nesting is true (e.g., that the assessment is inside the course).
  3. Load data from the DB and store it in the res.locals object.
  4. Execute the actual route handler that will read more DB data and render the page.
*/

// Middleware for admin pages
app.use('/admin/:courseInstanceId', require('./middlewares/checkAdminAuth'));
app.use('/admin/:courseInstanceId', require('./middlewares/currentCourseInstance'));
app.use('/admin/:courseInstanceId', require('./middlewares/currentEnrollment'));
app.use('/admin/:courseInstanceId', require('./middlewares/currentCourse'));
app.use('/admin/:courseInstanceId', require('./middlewares/adminUrlPrefix'));
app.use('/admin/:courseInstanceId', require('./middlewares/courseList'));
app.use('/admin/:courseInstanceId', require('./middlewares/courseInstanceList'));
app.use('/admin/:courseInstanceId/assessment/:assessmentId', require('./middlewares/currentAssessment'));
app.use('/admin/:courseInstanceId/question/:questionId', require('./middlewares/currentQuestion'));

// Route handlers for admin pages.
app.use('/admin', require('./pages/adminHome/adminHome'));
// redirect class page to assessments page
app.use(function(req, res, next) {if (/\/admin\/[0-9]+\/?$/.test(req.url)) {req.url = req.url.replace(/\/?$/, '/assessments');} next();});
app.use('/admin/:courseInstanceId/assessments', require('./pages/adminAssessments/adminAssessments'));
app.use('/admin/:courseInstanceId/assessment/:assessmentId', require('./pages/adminAssessment/adminAssessment'));
app.use('/admin/:courseInstanceId/users', require('./pages/adminUsers/adminUsers'));
app.use('/admin/:courseInstanceId/questions', require('./pages/adminQuestions/adminQuestions'));
app.use('/admin/:courseInstanceId/question/:questionId', require('./pages/adminQuestion/adminQuestion'));
app.use('/admin/:courseInstanceId/question/:questionId/file', require('./pages/questionFile/questionFile'));
app.use('/admin/:courseInstanceId/question/:questionId/text', require('./pages/questionText/questionText'));

// Middleware for user pages
app.use('/pl/', require('./middlewares/ensureUser'));
app.use('/pl/', require('./middlewares/userCourseInstanceList'));
app.use('/pl/:courseInstanceId', require('./middlewares/ensureEnrollment'));
app.use('/pl/:courseInstanceId', require('./middlewares/currentCourseInstance'));
app.use('/pl/:courseInstanceId', require('./middlewares/currentCourse'));
app.use('/pl/:courseInstanceId', require('./middlewares/userUrlPrefix'));
app.use('/pl/:courseInstanceId/assessment/:assessmentId', require('./middlewares/currentAssessment'));
app.use('/pl/:courseInstanceId/assessmentInstance/:assessmentInstanceId', require('./middlewares/currentAssessmentInstance'));
app.use('/pl/:courseInstanceId/assessmentInstance/:assessmentInstanceId', require('./middlewares/currentAssessment'));
app.use('/pl/:courseInstanceId/instanceQuestion/:instanceQuestionId', require('./middlewares/currentInstanceQuestion'));
app.use('/pl/:courseInstanceId/instanceQuestion/:instanceQuestionId', require('./middlewares/currentAssessmentInstance'));
app.use('/pl/:courseInstanceId/instanceQuestion/:instanceQuestionId', require('./middlewares/currentAssessment'));
app.use('/pl/:courseInstanceId/instanceQuestion/:instanceQuestionId', require('./middlewares/currentAssessmentQuestion'));
app.use('/pl/:courseInstanceId/instanceQuestion/:instanceQuestionId', require('./middlewares/currentQuestion'));

// Route handlers for user pages
app.use('/pl', require('./pages/userHome/userHome'));
// redirect class page to assessments page
app.use(function(req, res, next) {if (/\/pl\/[0-9]+\/?$/.test(req.url)) {req.url = req.url.replace(/\/?$/, '/assessments');} next();});
app.use('/pl/:courseInstanceId/assessments', require('./pages/userAssessments/userAssessments'));
// User assessments are all handled by type-specific pages.
// Each handler checks the assessment type and calls next() if it's the wrong type.
app.use('/pl/:courseInstanceId/assessment/:assessmentId', [
    require('./pages/userAssessmentHomework/userAssessmentHomework'),
    require('./pages/userAssessmentExam/userAssessmentExam'),
]);
app.use('/pl/:courseInstanceId/assessmentInstance/:assessmentInstanceId', [
    require('./pages/userAssessmentInstanceHomework/userAssessmentInstanceHomework'),
    require('./pages/userAssessmentInstanceExam/userAssessmentInstanceExam'),
]);
app.use('/pl/:courseInstanceId/assessmentInstance/:assessmentInstanceId/clientFiles', require('./pages/assessmentInstanceClientFiles/assessmentInstanceClientFiles'));
app.use('/pl/:courseInstanceId/instanceQuestion/:instanceQuestionId', [
    require('./pages/userInstanceQuestionHomework/userInstanceQuestionHomework'),
    require('./pages/userInstanceQuestionExam/userInstanceQuestionExam'),
]);
app.use('/pl/:courseInstanceId/instanceQuestion/:instanceQuestionId/file', require('./pages/questionFile/questionFile'));
app.use('/pl/:courseInstanceId/instanceQuestion/:instanceQuestionId/text', require('./pages/questionText/questionText'));

// error handling
app.use(require('./middlewares/notFound'));
app.use(require('./pages/error/error'));

var startServer = function(callback) {
    if (config.serverType === 'https') {
        var options = {
            key: fs.readFileSync('/etc/pki/tls/private/localhost.key'),
            cert: fs.readFileSync('/etc/pki/tls/certs/localhost.crt'),
            ca: [fs.readFileSync('/etc/pki/tls/certs/server-chain.crt')]
        };
        https.createServer(options, app).listen(config.serverPort);
        logger.info('server listening to HTTPS on port ' + config.serverPort);
        callback(null);
    } else if (config.serverType === 'http') {
        app.listen(config.serverPort);
        logger.info('server listening to HTTP on port ' + config.serverPort);
        callback(null);
    } else {
        callback('unknown serverType: ' + config.serverType);
    }
};

async.series([
    sqldb.init,
    startServer,
    // FIXME: we are short-circuiting this for development,
    // for prod these tasks should be back inline
    function(callback) {
        callback(null);
        async.eachSeries(config.courseDirs || [], function(courseDir, callback) {
            syncFromDisk.syncDiskToSql(courseDir, callback);
        }, function(err, data) {
            if (err) {
                logger.error('Error syncing SQL DB:', err, data, err.stack);
            } else {
                logger.infoOverride('Completed sync SQL DB');
            }
        });

        /*        
        async.series([
            syncDiskToSQL,
            syncMongoToSQL,
        ], function(err, data) {
            if (err) {
                logger.error('Error syncing SQL DB:', err, data);
            }
        });
        */
    },
], function(err, data) {
    if (err) {
        logger.error('Error initializing PrairieLearn server:', err, data);
        logger.error('Exiting...');
        process.exit(1);
    } else {
        logger.infoOverride('PrairieLearn server ready');
    }
});

//module.exports = app;