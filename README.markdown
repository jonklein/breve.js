breve.js (Javascript MultiAgent Simulation Kit)
==============================================

## Introduction ##

breve.js is a multiagent simulation toolkit that runs in the browser.

See some demos at [http://kleininen.com/breve.js](http://kleininen.com/breve.js).  API documentation available at [http://kleininen.com/breve.js/docs](http://kleininen.com/breve.js/docs)

*This is a work in progress.  Don't expect anything to work yet.  More documentation and details to come.*

## Building ##

breve.js is written in CoffeeScript and uses Sprockets to build to a single JavaScript file suitable for use in the browser.  A simple Makefile is provided to execute the build process.

## History ##

In 2001, I released a project called breve, a 3D multiagent simulation toolkit.  breve was used in a number of labs and classrooms around the world for research and education in areas such as multiagent simulation, biology, artificial intelligence and artificial life.  Over time, though, the project grew old, crufty and difficult to maintain, especially as I left the academic world and didn't have as much time to work on the project.

breve.js is a toolkit for building multiagent simulations, written using modern technologies and with the benefit of a great deal of retrospect.

# Building Simulations

breve.js simulations consist of a number of *agents* running in a breve *engine*.  The engine and its agents implement a number of methods which hook into the lifecycle of the simulation to inspect the environment and update their state accordingly.  Simulations are constructed by defining a set of agents and their behaviors.

## Agent Methods ##

Agents behaviors are largely implemented by overriding a number of methods that get called during the agent's lifecycle:
* setup, called when an agent is created
* step, called at each timestep during the simulation
* collide, called when the agent collides with another

## Simulation Configuration ##

Simulations are configured by passing a hash of configuration properties to the breve engine upon initialization.  The configuration properties specify the number, type and attributes of initial agents in the simulation, along with engine-level properties used to configure the simulation.  When the simulation is initialized, these properties are passed to the "setup" method of both the engine and the agents.  You should make every attempt to expose all configurable simulation parameters through the configuration hash so that the simulation can be easily tweaked and experimented with, without requiring changes to the code.

## Agent State vs. Object Properties ##

breve.js agents are plain javascript Objects, and as such, can be assigned arbitrary object properties.  However, these properties should not be used to store data which tracks the state of agents in the simulation.  Instead, agent states such as location, velocity, etc. should be set and retrieved on agents using "get" and "set".  Agent states managed using set/get will be properly handled when serializing, deserializing, copying and otherwise manipulating objects.  If these agent states are stored improperly as object properties, some of this functionality will not work as expected.

Object properties may still be useful, however, for storing temporary, runtime data which is not intrinsically part of the agent's state.  For example, when setting an agent's image, the image URL is stored as part of the agent state, but an actual Image object is stored as an object property in order to render the object at runtime.  When the agent is serialized or copied, the image URL in the agent's state will be preserved, but the actual Image object property will need to be recreated. 

## Utility Libraries and Functions ##

breve.js uses a number of external libraries for support, and makes these libraries available when writing simulations.  You may need to refer to documentation for these components separately:

* [Underscore](http://underscorejs.org/), general utility and functional programming support
* [Sylvester](http://sylvester.jcoglan.com/), vector and matrix math

# Tracking simulation results

Forthcoming.

# License

breve.js 0.0
http://kleininen.com/breve.js
(c) 2012-2013 Jonathan Klein
breve.js may be freely distributed under the MIT license.
