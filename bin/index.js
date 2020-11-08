#!/usr/bin/env node
const mqttFirebase = require('../lib/mqtt-aws-timestream.js')

if (require.main === module)
    mqttFirebase.start(process.argv.slice(2))
else
    mqttFirebase.start()