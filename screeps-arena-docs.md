# Screeps Arena API Reference

> **Source:** https://arena.screeps.com/docs/  
> **Generated:** 2025-10-27T21:49:05.168Z

This documentation covers 47 API sections including game objects, structures, utilities, and constants.

---

## arenaInfo

arenaInfo object game

### Members

#### name

arenaInfo.name name string

#### level

arenaInfo.level level number

#### season

arenaInfo.season season string

#### ticksLimit

arenaInfo.ticksLimit ticksLimit number

#### cpuTimeLimit

arenaInfo.cpuTimeLimit cpuTimeLimit number

#### cpuTimeLimitFirstTick

arenaInfo.cpuTimeLimitFirstTick cpuTimeLimitFirstTick number

---

## ConstructionSite

ConstructionSite class extends GameObject game/prototypes/game-object

### Members

#### my

ConstructionSite.my my boolean

#### progress

ConstructionSite.progress progress number

#### progressTotal

ConstructionSite.progressTotal progressTotal number

#### structure

ConstructionSite.structure structure Structure

#### remove

ConstructionSite.remove remove Remove this construction site.

---

## Creep

Creep class extends GameObject game/prototypes/creep

### Members

#### body

Creep.body body array

#### fatigue

Creep.fatigue fatigue number

#### hits

Creep.hits hits number

#### hitsMax

Creep.hitsMax hitsMax number

#### my

Creep.my my boolean

#### store

Creep.store store Store

#### attack

Creep.attack attack Attack another creep or structure in a short-ranged attack. Requires the ATTACK body part. If the target is inside a rampart, then the rampart is attacked instead. The target has to be at adjacent square to the creep.

#### build

Creep.build build Build a structure at the target construction site using carried energy. Requires WORK and CARRY body parts. The target has to be within 3 squares range of the creep.

#### drop

Creep.drop drop Drop this resource on the ground.

#### harvest

Creep.harvest harvest Harvest energy from the source. Requires the WORK body part. If the creep has an empty CARRY body part, the harvested resource is put into it; otherwise it is dropped on the ground. The target has to be at an adjacent square to the creep.

#### heal

Creep.heal heal Heal self or another creep. It will restore the target creep’s damaged body parts function and increase the hits counter. Requires the HEAL body part. The target has to be at adjacent square to the creep.

#### move

Creep.move move Move the creep one square in the specified direction. Requires the MOVE body part.

#### moveTo

Creep.moveTo moveTo Find the optimal path to the target and move to it. Requires the MOVE body part.

#### pickup

Creep.pickup pickup Pick up an item (a dropped piece of resource). Requires the CARRY body part. The target has to be at adjacent square to the creep or at the same square.

#### pull

Creep.pull pull Help another creep to follow this creep. The fatigue generated for the target's move will be added to the creep instead of the target. Requires the MOVE body part. The target has to be at adjacent square to the creep. The creep must move elsewhere, and the target must move towards the creep.

#### rangedAttack

Creep.rangedAttack rangedAttack A ranged attack against another creep or structure. Requires the RANGED_ATTACK body part. If the target is inside a rampart, the rampart is attacked instead. The target has to be within 3 squares range of the creep.

#### rangedHeal

Creep.rangedHeal rangedHeal Heal another creep at a distance. It will restore the target creep’s damaged body parts function and increase the hits counter. Requires the HEAL body part. The target has to be within 3 squares range of the creep.

#### rangedMassAttack

Creep.rangedMassAttack rangedMassAttack A ranged attack against all hostile creeps or structures within 3 squares range. Requires the RANGED_ATTACK body part. The attack power depends on the range to each target. Friendly units are not affected.

#### transfer

Creep.transfer transfer Transfer resource from the creep to another object. The target has to be at adjacent square to the creep.

#### withdraw

Creep.withdraw withdraw Withdraw resources from a structure. The target has to be at adjacent square to the creep. Multiple creeps can withdraw from the same object in the same tick. Your creeps can withdraw resources from hostile structures as well, in case if there is no hostile rampart on top of it.

---

## GameObject

GameObject class game/prototypes/game-object

### Members

#### exists

GameObject.exists exists boolean

#### id

GameObject.id id string

#### ticksToDecay

GameObject.ticksToDecay ticksToDecay number

#### x

GameObject.x x number

#### y

GameObject.y y number

#### findClosestByPath

GameObject.findClosestByPath findClosestByPath Find a position with the shortest path from this game object. (See game/utils findClosestByPath .)

#### findClosestByRange

GameObject.findClosestByRange findClosestByRange Find a position with the shortest linear distance from this game object. (See game/utils findClosestByRange ).

#### findInRange

GameObject.findInRange findInRange Find all objects in the specified linear range. See game/utils findInRange .

#### findPathTo

GameObject.findPathTo findPathTo Find a path from this object to the given position.

#### getRangeTo

GameObject.getRangeTo getRangeTo See game/utils getRange .

---

## OwnedStructure

OwnedStructure class extends Structure game/prototypes/owned-structure

### Members

#### my

OwnedStructure.my my boolean

---

## Resource

Resource class extends GameObject game/prototypes/resource

### Members

#### amount

Resource.amount amount number

#### resourceType

Resource.resourceType resourceType string

---

## Source

Source class extends GameObject game/prototypes/source

### Members

#### energy

Source.energy energy number

#### energyCapacity

Source.energyCapacity energyCapacity number

---

## Store

Store object game/prototypes/store

### Members

#### getCapacity

Store.getCapacity getCapacity Returns capacity of this store for the specified resource. For a general-purpose store, it returns total capacity if resource is undefined.

#### getFreeCapacity

Store.getFreeCapacity getFreeCapacity Returns free capacity for the store. For a limited store, it returns the capacity available for the specified resource if resource is defined and valid for this store.

#### getUsedCapacity

Store.getUsedCapacity getUsedCapacity Returns the capacity used by the specified resource. For a general-purpose store, it returns total used capacity if resource is undefined.

---

## Structure

Structure class extends GameObject game/prototypes/structure

### Members

#### hits

Structure.hits hits number

#### hitsMax

Structure.hitsMax hitsMax number

---

## StructureContainer

StructureContainer class extends OwnedStructure game/prototypes/container

### Members

#### store

StructureContainer.store store Store

---

## StructureExtension

StructureExtension class extends OwnedStructure game/prototypes/extension

### Members

#### store

StructureExtension.store store Store

---

## StructureRampart

StructureRampart class extends OwnedStructure game/prototypes/rampart

---

## StructureRoad

StructureRoad class extends Structure game/prototypes/road

---

## StructureSpawn

StructureSpawn class extends OwnedStructure game/prototypes/spawn

### Members

#### directions

StructureSpawn.directions directions array<number>

#### store

StructureSpawn.store store Store

#### spawning

StructureSpawn.spawning spawning Spawning

#### spawnCreep

StructureSpawn.spawnCreep spawnCreep Start the creep spawning process. The required energy amount can be withdrawn from all your spawns and extensions in the game.

#### setDirections

StructureSpawn.setDirections setDirections Set desired directions where creeps should move when spawned.

---

## StructureTower

StructureTower class extends OwnedStructure game/prototypes/tower

### Members

#### cooldown

StructureTower.cooldown cooldown number

#### store

StructureTower.store store Store

#### attack

StructureTower.attack attack Remotely attack any creep or structure in range.

#### heal

StructureTower.heal heal Remotely heal any creep in range.

---

## StructureWall

StructureWall class extends Structure game/prototypes/wall

---

## Spawning

Spawning object game/prototypes/spawn

### Members

#### needTime

Spawning.needTime needTime number

#### remainingTime

Spawning.remainingTime remainingTime number

#### creep

Spawning.creep creep Creep

#### cancel

Spawning.cancel cancel Cancel spawning immediately. Energy spent on spawning is not returned.

---

## CostMatrix

CostMatrix class game/path-finder

### Members

#### constructor

CostMatrix.constructor constructor Creates a new CostMatrix containing 0's for all positions.

#### set

CostMatrix.set set Set the cost of a position in this CostMatrix .

#### get

CostMatrix.get get Get the cost of a position in this CostMatrix .

#### clone

CostMatrix.clone clone Copy this CostMatrix into a new CostMatrix with the same data and return new CostMatrix

---

## Visual

Visual class game/visual

### Members

#### layer

Visual.layer layer number

#### persistent

Visual.persistent persistent boolean

#### constructor

Visual.constructor constructor Creates a new empty instance of Visual .

#### circle

Visual.circle circle game/visual Draw a circle.

#### clear

Visual.clear clear Remove all visuals from the object.

#### line

Visual.line line game/visual Draw a line.

#### poly

Visual.poly poly game/visual Draw a polyline.

#### rect

Visual.rect rect game/visual Draw a rectangle.

#### text

Visual.text text game/visual Draw a text label. You can use any valid Unicode characters, including emoji.

#### size

Visual.size size Get the stored size of all visuals stored in the object.

---

## createConstructionSite

createConstructionSite createConstructionSite game/utils Create new ConstructionSite at the specified location.

---

## findClosestByPath

findClosestByPath findClosestByPath game/utils Find a position with the shortest path from the given position.

---

## findClosestByRange

findClosestByRange findClosestByRange game/utils Find a position with the shortest linear distance from the given position.

---

## findInRange

findInRange findInRange game/utils Find all objects in the specified linear range.

---

## findPath

findPath findPath game/utils Find an optimal path between fromPos and toPos. Unlike searchPath , findPath avoid all obstacles by default (unless costMatrix is specified).

---

## getCpuTime

getCpuTime getCpuTime game/utils Get CPU wall time elapsed in the current tick in nanoseconds.

---

## getDirection

getDirection getDirection game/utils Get linear direction by differences of x and y.

---

## getHeapStatistics

getHeapStatistics getHeapStatistics game/utils Use this method to get heap statistics for your virtual machine. The return value is almost identical to the Node.js function v8.getHeapStatistics()[nodejs.org]. This function returns one additional property: externally_allocated_size which is the total amount of currently allocated memory which is not included in the v8 heap but counts against this isolate's memory limit. ArrayBuffer instances over a certain size are externally allocated and will be counted here.

---

## getObjectById

getObjectById getObjectById game/utils Get an object with the specified unique ID.

---

## getObjectsByPrototype

getObjectsByPrototype getObjectsByPrototype game/utils Get all objects in the game with the specified prototype, for example, all creeps.

---

## getObjects

getObjects getObjects game/utils Get all game objects in the game.

---

## getRange

getRange getRange game/utils Get linear range between two objects. a and b may be any object containing x and y properties.

---

## getTerrainAt

getTerrainAt getTerrainAt game/utils Get an integer representation of the terrain at the given position.

---

## getTicks

getTicks getTicks game/utils The number of ticks passed from the start of the current game.

---

## searchPath

searchPath searchPath game/path-finder Find an optimal path between origin and goal . Note that searchPath without costMatrix specified (see below) uses terrain data only.

---

## BodyPart

BodyPart class extends GameObject arena/season_beta/capture_the_flag/basic

### Members

#### type

BodyPart.type type string

#### ticksToDecay

BodyPart.ticksToDecay ticksToDecay number

---

## Flag

Flag class extends GameObject arena/season_beta/capture_the_flag/basic

### Members

#### my

Flag.my my boolean

---

## StructureTower

StructureTower class extends OwnedStructure arena/season_beta/capture_the_flag/basic

---

## AreaEffect

AreaEffect class extends GameObject arena/season_beta/collect_and_control/basic

### Members

#### effect

AreaEffect.effect effect string

---

## ScoreCollector

ScoreCollector class extends GameObject arena/season_beta/collect_and_control/basic

### Members

#### my

ScoreCollector.my my boolean

#### resourceType

ScoreCollector.resourceType resourceType string

#### score

ScoreCollector.score score number

#### scoreTotal

ScoreCollector.scoreTotal scoreTotal number

---

## EFFECT_DAMAGE

EFFECT_DAMAGE EFFECT_DAMAGE damage

---

## EFFECT_FREEZE

EFFECT_FREEZE EFFECT_FREEZE freeze

---

## EFFECT_HEAL

EFFECT_HEAL EFFECT_HEAL heal

---

## RESOURCE_SCORE

RESOURCE_SCORE RESOURCE_SCORE score

---

## RESOURCE_SCORE_X

RESOURCE_SCORE_X RESOURCE_SCORE_X score_x

---

## RESOURCE_SCORE_Y

RESOURCE_SCORE_Y RESOURCE_SCORE_Y score_y

---

## RESOURCE_SCORE_Z

RESOURCE_SCORE_Z RESOURCE_SCORE_Z score_z

---

## All

OK OK 0

---

