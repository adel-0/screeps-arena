import { getObjectsByPrototype, createConstructionSite, getTicks, findPath, getDirection } from 'game/utils';
import { Creep, StructureSpawn, Source, StructureContainer, StructureTower, ConstructionSite, StructureExtension, StructureWall } from 'game/prototypes';
import { MOVE, ATTACK, RANGED_ATTACK, WORK, CARRY, RESOURCE_ENERGY, ERR_NOT_IN_RANGE, HEAL } from 'game/constants';

let creepPaths = {}; // Cache paths: { creepId: { target: targetId, tick: lastCalculatedTick } }
let targetWall = null; // Wall blocking access to containers
let deployedAttackers = new Set(); // Track which attackers are deployed to attack
let firstWaveLaunched = false; // Track if initial wave of 5 has launched

/**
 * Spawn and Swamp Dominator
 */

const PATH_REFRESH_INTERVAL = 6; // Recalculate path every 10 ticks

/**
 * Find nearest enemy creep within specified range
 * @param {Creep} creep - The creep searching for enemies
 * @param {number} maxRange - Maximum distance to search
 * @returns {Creep|null} Nearest enemy creep or null if none found
 */
function findNearestEnemy(creep, maxRange) {
    const enemyCreeps = getObjectsByPrototype(Creep).filter(c => !c.my);

    let nearestEnemy = null;
    let minDistance = maxRange + 1;

    for (const enemy of enemyCreeps) {
        const distance = creep.getRangeTo(enemy);
        if (distance <= maxRange && distance < minDistance) {
            minDistance = distance;
            nearestEnemy = enemy;
        }
    }

    return nearestEnemy;
}

/**
 * Move creep to target with path caching to avoid constant rerouting
 * @param {Creep} creep - The creep to move
 * @param {object} target - The target object or position
 * @param {object} opts - Optional pathfinding options (e.g., { ignoreCreeps: true })
 */
function cachedMoveTo(creep, target, opts = {}) {
    const tick = getTicks();
    const targetId = target.id || `${target.x},${target.y}`;
    const pathCache = creepPaths[creep.id];

    // Check if creep is at expected position in cached path
    const isAtExpectedPosition = pathCache &&
                                  pathCache.pathIndex > 0 &&
                                  pathCache.pathIndex < pathCache.path.length &&
                                  pathCache.path[pathCache.pathIndex - 1].x === creep.x &&
                                  pathCache.path[pathCache.pathIndex - 1].y === creep.y;

    // Check if we need to recalculate path
    const needsNewPath = !pathCache ||
                         pathCache.target !== targetId ||
                         tick - pathCache.tick >= PATH_REFRESH_INTERVAL ||
                         pathCache.pathIndex >= pathCache.path.length ||
                         !isAtExpectedPosition;

    if (needsNewPath) {
        // Calculate new path with options
        const path = findPath(creep, target, opts);

        if (!path || path.length === 0) {
            return; // No valid path found
        }

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

        // Only increment path index if creep has reached the current step
        if (creep.x === nextStep.x && creep.y === nextStep.y) {
            cache.pathIndex++;
        }
    }
}

export function loop() {
    const mySpawn = getObjectsByPrototype(StructureSpawn).find(s => s.my);
    const enemySpawn = getObjectsByPrototype(StructureSpawn).find(s => !s.my);
    const myCreeps = getObjectsByPrototype(Creep).filter(c => c.my);

    // Clean up path cache and deployed attackers set for dead creeps
    const aliveCreepIds = new Set(myCreeps.map(c => c.id));
    for (const creepId in creepPaths) {
        if (!aliveCreepIds.has(creepId)) {
            delete creepPaths[creepId];
        }
    }
    for (const creepId of deployedAttackers) {
        if (!aliveCreepIds.has(creepId)) {
            deployedAttackers.delete(creepId);
        }
    }

    // Count creeps by body type
    const harvesters = myCreeps.filter(c => c.body.some(p => p.type === CARRY));
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

    // Deploy attack waves
    const undeployedAttackers = attackers.filter(a => !deployedAttackers.has(a.id));

    if (!firstWaveLaunched && attackers.length >= 5) {
        // Launch initial wave of 5
        for (const attacker of attackers) {
            deployedAttackers.add(attacker.id);
        }
        firstWaveLaunched = true;
    } else if (firstWaveLaunched && undeployedAttackers.length >= 3) {
        // Launch subsequent waves of 3
        for (let i = 0; i < 3 && i < undeployedAttackers.length; i++) {
            deployedAttackers.add(undeployedAttackers[i].id);
        }
    }

    // Build defenses after initial wave
    if (firstWaveLaunched) {
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
            mySpawn.spawnCreep([CARRY, CARRY, MOVE, MOVE]);
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

    // Find wall blocking access to enclosed containers
    if (!targetWall || targetWall.hits === undefined) {
        const containers = getObjectsByPrototype(StructureContainer).filter(c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
        const walls = getObjectsByPrototype(StructureWall);

        // Find walls that are directly adjacent (range 1) to containers with energy
        // These are walls forming the enclosure around the container
        const wallsBlockingContainers = walls.filter(wall =>
            containers.some(container => wall.getRangeTo(container) === 1)
        );

        // Pick the wall closest to our spawn to minimize travel time
        if (wallsBlockingContainers.length > 0) {
            targetWall = mySpawn.findClosestByRange(wallsBlockingContainers);
        }
    }

    // Creep behavior
    for (const creep of myCreeps) {
        const isHarvester = creep.body.some(p => p.type === CARRY);
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
            // Defender: active defense - heal friendlies and attack enemies in base area
            const damagedCreep = myCreeps.find(c => c.hits < c.hitsMax);

            if (damagedCreep) {
                // Priority 1: Heal damaged friendlies
                if (creep.heal(damagedCreep) === ERR_NOT_IN_RANGE) {
                    cachedMoveTo(creep, damagedCreep);
                }
            } else {
                // Priority 2: Attack enemies near base (within 5 tiles of spawn)
                const enemyCreeps = getObjectsByPrototype(Creep).filter(c => !c.my);
                const baseThreats = enemyCreeps.filter(e => e.getRangeTo(mySpawn) <= 5);

                if (baseThreats.length > 0) {
                    const closestThreat = creep.findClosestByRange(baseThreats);
                    if (closestThreat) {
                        if (creep.attack(closestThreat) === ERR_NOT_IN_RANGE) {
                            cachedMoveTo(creep, closestThreat);
                        }
                    }
                } else {
                    // Stay near spawn
                    if (creep.getRangeTo(mySpawn) > 3) {
                        cachedMoveTo(creep, mySpawn);
                    }
                }
            }
        } else {
            // Attacker: check if deployed for assault
            const isDeployed = deployedAttackers.has(creep.id);

            if (isDeployed && enemySpawn) {
                // Deployed attacker: balanced engagement - fight enemies while pushing to spawn
                const nearbyEnemy = findNearestEnemy(creep, 5);

                if (nearbyEnemy) {
                    // Engage enemy creeps encountered on the way
                    if (creep.attack(nearbyEnemy) === ERR_NOT_IN_RANGE) {
                        cachedMoveTo(creep, nearbyEnemy);
                    }
                } else {
                    // No enemies nearby, continue to enemy spawn
                    cachedMoveTo(creep, enemySpawn);
                    creep.attack(enemySpawn);
                }
            } else if (targetWall) {
                // Undeployed attacker: demolish wall blocking containers while waiting for wave
                if (creep.attack(targetWall) === ERR_NOT_IN_RANGE) {
                    cachedMoveTo(creep, targetWall);
                }
            }
        }
    }

    // Tower behavior: attack closest enemies in range
    const myTowers = getObjectsByPrototype(StructureTower).filter(t => t.my);
    for (const tower of myTowers) {
        const enemyCreeps = getObjectsByPrototype(Creep).filter(c => !c.my);
        if (enemyCreeps.length > 0 && !tower.cooldown) {
            // Prioritize closest enemy to spawn
            const closestEnemy = mySpawn.findClosestByRange(enemyCreeps);
            if (closestEnemy) {
                tower.attack(closestEnemy);
            }
        }
    }
}
