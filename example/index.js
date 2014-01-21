/**
 * This example shows how to use minions to process messages coming in from
 * rabbitmq.
 * 
 * Copyright 2014 Marcelo Gornstein &lt;marcelog@@gmail.com&gt;
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * copyright Marcelo Gornstein <marcelog@gmail.com>
 * author Marcelo Gornstein <marcelog@gmail.com>
 */
var minionsMod = require('../src/rabbitmq_minionpool');
var amqpMod = require('amqp');
var util = require('util');

var options = {
  name: 'test',
  debug: true,
  concurrency: 5,
  logger: console.log,
  mqOptions: {
    host: '127.0.0.1',
    login: 'guest',
    password: 'guest',
    authMechanism: 'AMQPLAIN',
    vhost: '/',
    reconnect: true,
    reconnectBackoffStrategy: 'linear',
    reconnectExponentialLimit: 120000,
    reconnectBackoffTime: 1000,
    exchangeName: 'myWorkers',  // Will also create myWorkers.retry
    queueName: 'do_something',  // Will also create do_something.retry
    routingKey: 'do_something',
    retryTimeout: 20000
  },
  minionTaskHandler: function(data, state, callback) {
    var queue = data.queue;
    var task = data.queue;
    console.log('got task: %s', task);
    queue.shift(true, false);
    callback(undefined, state);
  },
  poolEnd: function() {
    process.exit(0);
  }
};

var pool = new minionsMod.RabbitMqMinionPool(options);
process.on('SIGINT', function() {
  pool.end();
});
pool.start();
