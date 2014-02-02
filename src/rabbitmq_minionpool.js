var minionPoolMod = require('minionpool');
var amqpMod = require('amqp');
var util = require('util');
var Step = require('step');

function RabbitMqMinionPool(options) {
  var self = this;
  var superTaskSourceStart = this.dummyTaskSourceStart;
  var superMinionStart = this.dummyMinionStart;
  var superMinionEnd = this.dummyMinionEnd;
  var superTaskSourceEnd = this.dummyTaskSourceEnd;
  var superTaskSourceNext = options.taskSourceNext;
  var superPoolEnd = this.dummyPoolEnd;
  var superMinionTaskHandler = options.minionTaskHandler;

  // Tasks wont be get by polling, but by someone calling injectTask() on the pool
  options.taskSourceNext = undefined;
  options.mqOptions.defaultExchangeName = options.mqOptions.exchangeName;
  var routingKey = options.mqOptions.routingKey;
  if(routingKey === undefined) {
    options.mqOptions.queueName;
  }

  var exchangeName = options.mqOptions.exchangeName;
  var queueName = options.mqOptions.queueName;

  if(options.taskSourceStart !== undefined) {
    superTaskSourceStart = options.taskSourceStart;
  }
  if(options.taskSourceEnd !== undefined) {
    superTaskSourceEnd = options.taskSourceEnd;
  }
  if(options.minionStart !== undefined) {
    superMinionStart = options.minionStart;
  }
  if(options.minionEnd !== undefined) {
    superMinionEnd = options.minionEnd;
  }
  if(options.poolEnd !== undefined) {
    superPoolEnd = options.poolEnd;
  }

  options.minionStart = function(callback) {
    superMinionStart(function(err, state) {
      if(err) {
        callback(err, state);
      } else {
        state.connection = amqpMod.createConnection(self.amqpConfig);
        state.connection.on('error', function(what) {
          options.logger('General Error: ' + util.inspect(what));
        });
        state.connection.on('ready', function() {
          Step(
            function workersExchange() {
              self.createWorkersExchange(state.connection, exchangeName, this);
            },
            function workersRetryExchange(workersExchange) {
              state.exchange = workersExchange;
              self.createWorkersRetryExchange(state.connection, exchangeName, this);
            },
            function done(workersRetryExchange) {
              state.exchangeRetry = workersRetryExchange;
              callback(undefined, state);
            }
          );
        });        
      }
    });
  };
  options.minionEnd = function(state, callback) {
    state.connection.end();
    superMinionEnd(state, callback);
  };
  options.poolEnd = function() {
    superPoolEnd();
  };
  options.taskSourceEnd = function(state, callback) {
    state.connection.end();
    superTaskSourceEnd(state, callback);
  };
  options.taskSourceStart = function(callback) {
    superTaskSourceStart(function(err, state) {
      if(err) {
        callback(err, state);
      } else {
        state.connection = amqpMod.createConnection(self.amqpConfig);
        state.connection.on('error', function(what) {
          options.logger('General Error: ' + util.inspect(what));
        });
        state.connection.on('ready', function() {
          Step(
            function workersExchange() {
              self.createWorkersExchange(state.connection, exchangeName, this);
            },
            function workersRetryExchange(workersExchange) {
              state.exchange = workersExchange;
              self.createWorkersRetryExchange(state.connection, exchangeName, this);
            },
            function workersRetryQueue(workersRetryExchange) {
              state.exchangeRetry = workersRetryExchange;
              self.createRetryQueue(
                state.connection, exchangeName, queueName, routingKey, {}, this
              );
            },
            function workersQueue(workersRetryQueue) {
              state.queueRetry = workersRetryQueue;
              self.createWorkerQueue(
                state.connection, exchangeName, queueName, routingKey, {}, this
              );
            },
            function done(workersQueue) {
              state.queue = workersQueue;
              state.queue.subscribe(
                {ack: true, prefetchCount: self.concurrency},
               function(payload, headers, deliveryInfo, message) {
                  self.injectTaskInternal({
                    payload: payload,
                    headers: headers,
                    deliveryInfo: deliveryInfo,
                    message: message,
                    queue: workersQueue
                  });
                }
              );
              callback(undefined, state);
            }
          );
        });
      }
    });
  }
  RabbitMqMinionPool.super_.call(this, options);
}

util.inherits(RabbitMqMinionPool, minionPoolMod.MinionPool);

RabbitMqMinionPool.prototype.injectTaskInternal = function(data) {
  var self = this;
  self.injectTask(data);
};

RabbitMqMinionPool.prototype.createWorkersExchange = function(connection, name, callback) {
  var args = {};
  return this.createExchange(connection, name, args, callback);
};

RabbitMqMinionPool.prototype.createWorkersRetryExchange = function(connection, name, callback) {
  var args = {};
  // Expiration will move these to the original exchange.queue
  return this.createExchange(connection, this.retryNameFor(name), args, callback);
};

RabbitMqMinionPool.prototype.createWorkerQueue = function(
  connection, exchangeName, queueName, key, args, callback
) {
  // Nacks will send these to the dlx.
  var args = {};
  args['x-dead-letter-exchange'] = this.retryNameFor(exchangeName);
  // we want a different retry queue so retry operations for 'this' consumer
  // wont reach others.
  args['x-dead-letter-routing-key'] = this.retryNameFor(queueName);
  this.createQueue(connection, queueName, args, exchangeName, key, callback);
};

RabbitMqMinionPool.prototype.createRetryQueue = function(
  connection, exchangeName, queueName, key, args, callback
) {
  var args = {};
  var name = this.retryNameFor(queueName);
  var self = this;
  args['x-dead-letter-exchange'] = exchangeName;
  // send retry operations no to 'key', but to 'queueName'
  args['x-dead-letter-routing-key'] = queueName;
  args['x-message-ttl'] = this.mqOptions.retryTimeout;
  this.createQueue(connection, name, args, this.retryNameFor(exchangeName), this.retryNameFor(queueName), callback);
};

RabbitMqMinionPool.prototype.createQueue = function(
  connection, queueName, args, exchangeName, key, callback
) {
  var options = this.queueOptions(args);
  var self = this;
  connection.queue(queueName, options, function(queue) {
    /*
     * We bind to the routing key so we can consume messages from the needed
     * routingKey, but also directed to our own queue name (useful to send retried
     * operations to the right consumer).
     */
    queue.bind(exchangeName, key);
    queue.bind(exchangeName, queueName);
    if(self.debug) {
      self.debugMsg('Queue: ' + queueName + ' binded to: ' + key);
    }
    callback(queue);
  });
};

RabbitMqMinionPool.prototype.createExchange = function(connection, name, args, callback) {
  var options = this.workersExchangeOptions(args);
  var self = this;
  connection.exchange(name, options, function (exchange) {
    self.logger('Exchange ' + name + ' is open');
    callback(exchange);
  });
};

RabbitMqMinionPool.prototype.retryNameFor = function(name) {
  return name + '.retry';
};

RabbitMqMinionPool.prototype.queueOptions = function(args) {
  return {
    autoDelete: false,
    durable: true,
    exclusive: false,
    arguments: args ? args : {}
  };
};

RabbitMqMinionPool.prototype.workersExchangeOptions = function(args) {
  return {
    type: 'direct',
    passive: false,
    durable: true,
    confirm: true,
    autoDelete: false,
    arguments: args ? args : {}
  };
};

RabbitMqMinionPool.prototype.publish = function(exchange, key, payload, callback) {
  var self = this;
  var options = {
    mandatory: true,
    delivery_mode: 2,
    immediate: false
  };
  var cleanup = function() {
    exchange.removeAllListeners('basic-ack');
    exchange.removeAllListeners('basic-return');
    exchange.removeAllListeners('basic-nack');
  };
  var timeoutId = setTimeout(function() {
    cleanup();
    callback('not acked');
  }, self.mqOptions.publishAckTimeout);
  exchange.once('basic-nack', function(argsNack) {
    clearTimeout(timeoutId);
    cleanup();
    callback('nack');
  });
  exchange.once('basic-return', function(argsRet) {
    clearTimeout(timeoutId);
    cleanup();
    callback(argsRet);
  });
  exchange.once('basic-ack', function(argsAck) {
    clearTimeout(timeoutId);
    cleanup();
    callback();
  });
  exchange.publish(key, JSON.stringify(payload), options, function(withError, error) {
    if(withError) {
      clearTimeout(timeoutId);
      cleanup();
      callback(error);
    }
  });
};

exports.RabbitMqMinionPool = RabbitMqMinionPool;
