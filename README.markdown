breve.js (Javascript MultiAgent Simulation Kit)
==============================================

## Introduction ##

breve.js is a multiagent simulation toolkit that runs in the browser.

## Building ##

breve.js is written in CoffeeScript and uses Sprockets to build to a single JavaScript file suitable for use in the browser.  A simple Makefile is provided to execute the build process.

## Agent State vs. Object Properties ##

breve.js agents are plain javascript Objects, and as such, can be assigned arbitrary object properties.  However, these properties should not be used to store data which tracks the state of agents in the simulation.  Instead, agent states such as location, velocity, etc. should be set and retrieved on agents using "get" and "set".  Agent states managed using set/get will be properly handled when serializing, deserializing, copying and otherwise manipulating objects.  If these agent states are stored improperly as object properties, some of this functionality will not work as expected.

Object properties may still be useful, however, for storing temporary, runtime data which is not intrinsically part of the agent's state.  For example, when setting an agent's image, the image URL is stored as part of the agent state, but an actual Image object is stored as an object property in order to render the object at runtime.  When the agent is serialized or copied, the image URL in the agent's state will be preserved, but the actual Image object property will need to be recreated. 

## History ##

In 2001, I released a project called breve, a multiagent simulation toolkit.  breve was used in a number of labs and classrooms around the world for research and education in areas such as multiagent simulation, biology, artificial intelligence and artificial life.  Over time, though, the project grew old, crufty and difficult to maintain, especially as I left the academic world and didn't have as much time to work on the project.

