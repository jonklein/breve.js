breve_js (Javascript MultiAgent Simulation Kit)
==============================================

## Introduction ##

breveJS is a multiagent simulation toolkit that runs in the browser.

## Agent State vs. Object Properties ##

breveJS agents are plain javascript Objects, and as such, can be assigned arbitrary properties.  

However, these properties should not be used to store data which tracks the state of agents in the simulation.  Instead, agent states should be set and retrieved on agents using "get" and "set"

## History ##

In 2001, I released a project called breve, a multiagent simulation toolkit.

breve was used in a number of labs and classrooms around the world for research and education in areas such as multiagent simulation, biology, artificial intelligence and artificial life.

Over time, the project grew old and difficult to maintain, especially as I moved to jobs that did not 