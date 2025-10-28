import { getObjectsByPrototype, createConstructionSite, getTicks, findPath, getDirection } from 'game/utils';
import { Creep, StructureSpawn, Source, StructureContainer, StructureTower, ConstructionSite, StructureExtension } from 'game/prototypes';
import { MOVE, ATTACK, RANGED_ATTACK, WORK, CARRY, RESOURCE_ENERGY, ERR_NOT_IN_RANGE, HEAL } from 'game/constants';

let attackWaveLaunched = false;
let creepPaths = {}; // Cache paths: { creepId: { target: targetId, tick: lastCalculatedTick } }

/**
 * Spawn and Swamp Dominator
 */

const PATH_REFRESH_INTERVAL = 10; // Recalculate path every 10 ticks

/**
 * Move creep to target with path caching to avoid constant rerouting
 */
function cachedMoveTo(creep, target) {
    const tick = getTicks();
    const targetId = target.id || `${target.x},${target.y}`;
    const pathCache = creepPaths[creep.id];

    // Check if we need to recalculate path
    const needsNewPath = !pathCache ||
                         pathCache.target !== targetId ||
                         tick - pathCache.tick >= PATH_REFRESH_INTERVAL ||
                         pathCache.pathIndex >= pathCache.path.length;

    if (needsNewPath) {
        // Calculate new path
        const path = findPath(creep, target);
        creepPaths[creep.id] = {
            target: targetId,
            tick: tick,
            path: path,
            pathIndex: 0
        };
    }

    // Follow cached path
    const cache = creepPaths[creep.id];
    if (cache.path && cache.pathIndex < cache.path.length) {
        const nextStep = cache.path[cache.pathIndex];
        const direction = getDirection(nextStep.x - creep.x, nextStep.y - creep.y);
        creep.move(direction);
        cache.pathIndex++;
    }
}

export function loop() {
    const mySpawn = getObjectsByPrototype(StructureSpawn).find(s => s.my);
    const enemySpawn = getObjectsByPrototype(StructureSpawn).find(s => !s.my);
    const myCreeps = getObjectsByPrototype(Creep).filter(c => c.my);

    // Clean up path cache for dead creeps
    const aliveCreepIds = new Set(myCreeps.map(c => c.id));
    for (const creepId in creepPaths) {
        if (!aliveCreepIds.has(creepId)) {
            delete creepPaths[creepId];
        }
    }

    // Count creeps by body type
    const harvesters = myCreeps.filter(c => c.body.some(p => p.type === WORK));
    const attackers = myCreeps.filter(c => c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK));
    const defenders = myCreeps.filter(c => c.body.some(p => p.type === HEAL));

    // Build extensions early for economy boost
    if (harvesters.length >= 1) {
        const extensions = getObjectsByPrototype(StructureExtension).filter(e => e.my);
        const constructionSites = getObjectsByPrototype(ConstructionSite).filter(s => s.my);
        const extensionSites = constructionSites.filter(s => s.structureType === 'extension');
        const totalExtensions = extensions.length + extensionSites.length;

        // Build up to 5 extensions in efficient pattern around spawn
        if (totalExtensions < 5) {
            const extensionPositions = [
                { x: mySpawn.x - 1, y: mySpawn.y - 1 },
                { x: mySpawn.x + 1, y: mySpawn.y - 1 },
                { x: mySpawn.x - 1, y: mySpawn.y + 1 },
                { x: mySpawn.x + 1, y: mySpawn.y + 1 },
                { x: mySpawn.x, y: mySpawn.y - 1 }
            ];

            for (const pos of extensionPositions) {
                if (totalExtensions >= 5) break;

                // Check if position is not already occupied by construction site or structure
                const hasConstructionSite = constructionSites.some(s => s.x === pos.x && s.y === pos.y);
                if (!hasConstructionSite) {
                    createConstructionSite(pos.x, pos.y, 'extension');
                    break; // Build one per tick
                }
            }
        }
    }

    // Mark when initial attack wave is ready
    if (attackers.length >= 10) {
        attackWaveLaunched = true;
    }

    // Build defenses after initial wave
    if (attackWaveLaunched) {
        const towers = getObjectsByPrototype(StructureTower).filter(t => t.my);
        const constructionSites = getObjectsByPrototype(ConstructionSite).filter(s => s.my);

        // Build tower and rampart near spawn if not already built/planned
        if (towers.length === 0 && constructionSites.length === 0) {
            createConstructionSite(mySpawn.x + 2, mySpawn.y, 'tower');
            createConstructionSite(mySpawn.x, mySpawn.y, 'rampart');
        }
    }

    // Spawn strategy
    if (mySpawn && !mySpawn.spawning) {
        if (harvesters.length < 3) {
            // Phase 1: Harvesters
            mySpawn.spawnCreep([WORK, WORK, CARRY, MOVE]);
        } else if (attackers.length < 10) {
            // Phase 2: Initial attack wave
            mySpawn.spawnCreep([MOVE, MOVE, ATTACK, ATTACK]);
        } else if (defenders.length < 5) {
            // Phase 3: Defensive creeps
            mySpawn.spawnCreep([MOVE, HEAL]);
        } else {
            // Phase 4: Continue offense
            mySpawn.spawnCreep([MOVE, MOVE, ATTACK, ATTACK]);
        }
    }

    // Attack only when we have enough units for a group assault
    const shouldAttack = attackers.length >= 5;

    // Creep behavior
    for (const creep of myCreeps) {
        const isHarvester = creep.body.some(p => p.type === WORK);
        const isDefender = creep.body.some(p => p.type === HEAL);

        if (isHarvester) {
            // Harvester: collect energy, build structures, return to spawn
            const constructionSite = creep.findClosestByPath(getObjectsByPrototype(ConstructionSite).filter(s => s.my));

            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && constructionSite) {
                // Build if we have energy and construction sites exist
                if (creep.build(constructionSite) === ERR_NOT_IN_RANGE) {
                    cachedMoveTo(creep, constructionSite);
                }
            } else if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                // Collect energy - prioritize containers, then sources with energy
                const container = creep.findClosestByPath(
                    getObjectsByPrototype(StructureContainer).filter(c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
                );
                const source = creep.findClosestByPath(
                    getObjectsByPrototype(Source).filter(s => s.energy > 0)
                );

                if (container) {
                    if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        cachedMoveTo(creep, container);
                    }
                } else if (source) {
                    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                        cachedMoveTo(creep, source);
                    }
                }
            } else {
                // Return energy to spawn or extensions
                const extensions = getObjectsByPrototype(StructureExtension).filter(
                    e => e.my && e.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                );
                const target = extensions.length > 0 ?
                    creep.findClosestByPath(extensions) :
                    mySpawn;

                if (target) {
                    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        cachedMoveTo(creep, target);
                    }
                }
            }
        } else if (isDefender) {
            // Defender: stay near spawn and heal damaged units
            const damagedCreep = myCreeps.find(c => c.hits < c.hitsMax);
            if (damagedCreep) {
                if (creep.heal(damagedCreep) === ERR_NOT_IN_RANGE) {
                    cachedMoveTo(creep, damagedCreep);
                }
            } else {
                // Stay near spawn
                if (creep.getRangeTo(mySpawn) > 3) {
                    cachedMoveTo(creep, mySpawn);
                }
            }
        } else {
            // Attacker: wait for group, then assault
            if (shouldAttack && enemySpawn) {
                cachedMoveTo(creep, enemySpawn);
                creep.attack(enemySpawn);
                creep.rangedAttack(enemySpawn);
            }
        }
    }

    // Tower behavior: attack enemies in range
    const myTowers = getObjectsByPrototype(StructureTower).filter(t => t.my);
    for (const tower of myTowers) {
        const enemyCreeps = getObjectsByPrototype(Creep).filter(c => !c.my);
        if (enemyCreeps.length > 0 && !tower.cooldown) {
            tower.attack(enemyCreeps[0]);
        }
    }
}
