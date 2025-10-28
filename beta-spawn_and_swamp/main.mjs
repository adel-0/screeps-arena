import { getObjectsByPrototype, createConstructionSite, getTicks, findPath, getDirection } from 'game/utils';
import { Creep, StructureSpawn, Source, StructureContainer, StructureTower, ConstructionSite, StructureExtension, StructureWall } from 'game/prototypes';
import { MOVE, ATTACK, RANGED_ATTACK, WORK, CARRY, RESOURCE_ENERGY, ERR_NOT_IN_RANGE, HEAL, TOUGH } from 'game/constants';

let creepPaths = {}; // Cache paths: { creepId: { target: targetId, tick: lastCalculatedTick } }
let targetWall = null; // Wall blocking access to containers
let deployedAttackers = new Set(); // Track which attackers are deployed to attack
let deployedMedics = new Set(); // Track which medics are deployed for combat support
let squadAssignments = {}; // Map creep ID to squad name (e.g., "Alpha", "Bravo", "Charlie")
let nextSquadIndex = 0; // Track next squad to deploy

// NATO alphabet for squad naming
const NATO_ALPHABET = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
    "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa",
    "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu"
];

/**
 * Spawn and Swamp Dominator
 */

// Configuration Constants
const PATH_REFRESH_INTERVAL = 5; // Recalculate path every 5 ticks
const OFFPATH_DETECTION_THRESHOLD = 2; // Max tiles away from expected path position

// Extension Construction
const MIN_HARVESTERS_FOR_EXTENSIONS = 1;
const MAX_EXTENSIONS = 5;

// Squad Composition
const ATTACKERS_PER_SQUAD = 3;
const MEDICS_PER_SQUAD = 1;

// Unit Production Targets
const TARGET_HARVESTER_COUNT = 3;

// Combat and Defense Ranges
const BASE_THREAT_DETECTION_RANGE = 40; // Range to detect enemies near base
const DEFENDER_IDLE_RANGE = 3; // Distance from spawn for idle defenders
const ATTACKER_ENEMY_DETECTION_RANGE = 5; // Range for attackers to detect enemies
const MEDIC_FOLLOW_RANGE = 2; // Max range before medic moves to follow assault force
const CONTAINER_WALL_ADJACENCY = 1; // Range to detect walls blocking containers

/**
 * Get all enemy creeps
 * @returns {Creep[]} Array of enemy creeps
 */
function getAllEnemyCreeps() {
    return getObjectsByPrototype(Creep).filter(c => !c.my);
}

/**
 * Categorize creeps by role based on body parts
 * @param {Creep[]} myCreeps - Array of friendly creeps
 * @returns {object} Object with harvesters, attackers, and medics arrays
 */
function categorizeCreeps(myCreeps) {
    return {
        harvesters: myCreeps.filter(c => c.body.some(p => p.type === CARRY)),
        attackers: myCreeps.filter(c => c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK)),
        medics: myCreeps.filter(c => c.body.some(p => p.type === HEAL))
    };
}

/**
 * Find nearest enemy creep within specified range
 * @param {Creep} creep - The creep searching for enemies
 * @param {number} maxRange - Maximum distance to search
 * @returns {Creep|null} Nearest enemy creep or null if none found
 */
function findNearestEnemy(creep, maxRange) {
    const enemyCreeps = getAllEnemyCreeps();

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

    // Check if creep is significantly off-path
    let isSignificantlyOffPath = false;
    if (pathCache && pathCache.pathIndex > 0 && pathCache.pathIndex < pathCache.path.length) {
        const expectedPos = pathCache.path[pathCache.pathIndex - 1];
        const distance = Math.max(Math.abs(creep.x - expectedPos.x), Math.abs(creep.y - expectedPos.y));
        isSignificantlyOffPath = distance > OFFPATH_DETECTION_THRESHOLD;
    }

    // Check if we need to recalculate path
    const needsNewPath = !pathCache ||
                         pathCache.target !== targetId ||
                         tick - pathCache.tick >= PATH_REFRESH_INTERVAL ||
                         pathCache.pathIndex >= pathCache.path.length ||
                         isSignificantlyOffPath;

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

/**
 * Clean up state tracking for dead creeps
 * @param {Creep[]} myCreeps - Array of currently alive friendly creeps
 */
function cleanupDeadCreepState(myCreeps) {
    const aliveCreepIds = new Set(myCreeps.map(c => c.id));

    // Clean up path cache
    for (const creepId in creepPaths) {
        if (!aliveCreepIds.has(creepId)) {
            delete creepPaths[creepId];
        }
    }

    // Clean up deployed attackers set
    for (const creepId of deployedAttackers) {
        if (!aliveCreepIds.has(creepId)) {
            deployedAttackers.delete(creepId);
        }
    }

    // Clean up deployed medics set
    for (const creepId of deployedMedics) {
        if (!aliveCreepIds.has(creepId)) {
            deployedMedics.delete(creepId);
        }
    }

    // Clean up squad assignments
    for (const creepId in squadAssignments) {
        if (!aliveCreepIds.has(creepId)) {
            delete squadAssignments[creepId];
        }
    }
}

/**
 * Manage extension construction around spawn
 * @param {StructureSpawn} mySpawn - The friendly spawn
 * @param {Creep[]} harvesters - Array of harvester creeps
 */
function manageExtensionConstruction(mySpawn, harvesters) {
    if (harvesters.length >= MIN_HARVESTERS_FOR_EXTENSIONS) {
        const extensions = getObjectsByPrototype(StructureExtension).filter(e => e.my);
        const constructionSites = getObjectsByPrototype(ConstructionSite).filter(s => s.my);
        const extensionSites = constructionSites.filter(s => s.structureType === 'extension');
        const totalExtensions = extensions.length + extensionSites.length;

        if (totalExtensions < MAX_EXTENSIONS) {
            const extensionPositions = [
                { x: mySpawn.x - 1, y: mySpawn.y - 1 },
                { x: mySpawn.x + 1, y: mySpawn.y - 1 },
                { x: mySpawn.x - 1, y: mySpawn.y + 1 },
                { x: mySpawn.x + 1, y: mySpawn.y + 1 },
                { x: mySpawn.x, y: mySpawn.y - 1 }
            ];

            for (const pos of extensionPositions) {
                if (totalExtensions >= MAX_EXTENSIONS) break;

                const hasConstructionSite = constructionSites.some(s => s.x === pos.x && s.y === pos.y);
                if (!hasConstructionSite) {
                    createConstructionSite(pos.x, pos.y, 'extension');
                    break;
                }
            }
        }
    }
}

/**
 * Deploy complete squads with NATO alphabet naming
 * @param {Creep[]} attackers - Array of attacker creeps
 * @param {Creep[]} medics - Array of medic creeps
 */
function deployAttackWaves(attackers, medics) {
    const undeployedAttackers = attackers.filter(a => !deployedAttackers.has(a.id));
    const undeployedMedics = medics.filter(d => !deployedMedics.has(d.id));

    // Deploy complete squads only when we have enough units
    if (undeployedAttackers.length >= ATTACKERS_PER_SQUAD && undeployedMedics.length >= MEDICS_PER_SQUAD) {
        const squadName = NATO_ALPHABET[nextSquadIndex % NATO_ALPHABET.length];

        // Deploy attackers
        for (let i = 0; i < ATTACKERS_PER_SQUAD; i++) {
            const attacker = undeployedAttackers[i];
            deployedAttackers.add(attacker.id);
            squadAssignments[attacker.id] = squadName;
        }

        // Deploy medics
        for (let i = 0; i < MEDICS_PER_SQUAD; i++) {
            const medic = undeployedMedics[i];
            deployedMedics.add(medic.id);
            squadAssignments[medic.id] = squadName;
        }

        nextSquadIndex++;
    }
}

/**
 * Build defenses after initial squad deployment
 * @param {StructureSpawn} mySpawn - The friendly spawn
 */
function manageBuildDefenses(mySpawn) {
    if (nextSquadIndex >= 1) {
        const towers = getObjectsByPrototype(StructureTower).filter(t => t.my);
        const constructionSites = getObjectsByPrototype(ConstructionSite).filter(s => s.my);

        if (towers.length === 0 && constructionSites.length === 0) {
            createConstructionSite(mySpawn.x + 2, mySpawn.y, 'tower');
            createConstructionSite(mySpawn.x, mySpawn.y, 'rampart');
        }
    }
}

/**
 * Execute spawn strategy based on current unit composition
 * @param {StructureSpawn} mySpawn - The friendly spawn
 * @param {Creep[]} harvesters - Array of harvester creeps
 * @param {Creep[]} attackers - Array of attacker creeps
 * @param {Creep[]} medics - Array of medic creeps
 */
function executeSpawnStrategy(mySpawn, harvesters, attackers, medics) {
    if (mySpawn && !mySpawn.spawning) {
        if (harvesters.length < TARGET_HARVESTER_COUNT) {
            // Phase 1: Build economy with harvesters
            mySpawn.spawnCreep([CARRY, CARRY, MOVE, MOVE]);
        } else {
            // Phase 2: Build squads - maintain ratio of 3 attackers per 1 medic
            const undeployedAttackers = attackers.filter(a => !deployedAttackers.has(a.id));
            const undeployedMedics = medics.filter(m => !deployedMedics.has(m.id));

            if (undeployedAttackers.length >= ATTACKERS_PER_SQUAD && undeployedMedics.length < MEDICS_PER_SQUAD) {
                // Need medic to complete squad
                mySpawn.spawnCreep([MOVE, MOVE, HEAL, HEAL]);
            } else {
                // Spawn attackers to fill squads
                mySpawn.spawnCreep([TOUGH, TOUGH, MOVE, MOVE, MOVE, ATTACK, ATTACK, ATTACK]);
            }
        }
    }
}

/**
 * Update target wall blocking container access
 * @param {StructureSpawn} mySpawn - The friendly spawn
 */
function updateContainerWallTarget(mySpawn) {
    if (!targetWall || targetWall.hits === undefined) {
        const containers = getObjectsByPrototype(StructureContainer).filter(c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
        const walls = getObjectsByPrototype(StructureWall);

        // Find walls that are directly adjacent to containers with energy
        const wallsBlockingContainers = walls.filter(wall =>
            containers.some(container => wall.getRangeTo(container) === CONTAINER_WALL_ADJACENCY)
        );

        if (wallsBlockingContainers.length > 0) {
            targetWall = mySpawn.findClosestByRange(wallsBlockingContainers);
        }
    }
}

/**
 * Run harvester creep behavior
 * @param {Creep} creep - The harvester creep
 * @param {StructureSpawn} mySpawn - The friendly spawn
 */
function runHarvesterBehavior(creep, mySpawn) {
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
}

/**
 * Run medic creep behavior
 * @param {Creep} creep - The medic creep
 * @param {StructureSpawn} mySpawn - The friendly spawn
 * @param {Creep[]} myCreeps - All friendly creeps
 * @param {StructureSpawn} enemySpawn - The enemy spawn
 */
function runMedicBehavior(creep, mySpawn, myCreeps, enemySpawn) {
    const isDeployedMedic = deployedMedics.has(creep.id);

    if (isDeployedMedic && enemySpawn) {
        // Deployed combat medic: follow and continuously heal squad members only
        const medicSquad = squadAssignments[creep.id];
        const squadmates = myCreeps.filter(c =>
            c.id !== creep.id &&
            squadAssignments[c.id] === medicSquad &&
            deployedAttackers.has(c.id)
        );

        if (squadmates.length > 0) {
            // Heal squad members only
            const damagedSquadmate = squadmates
                .filter(c => c.hits < c.hitsMax)
                .sort((a, b) => a.hits - b.hits)[0];

            if (damagedSquadmate) {
                // Priority: Heal wounded squad members
                if (creep.heal(damagedSquadmate) === ERR_NOT_IN_RANGE) {
                    cachedMoveTo(creep, damagedSquadmate, { ignoreCreeps: true });
                }
            } else {
                // No wounded, continuously heal undamaged squad members
                const nearestSquadmate = creep.findClosestByRange(squadmates);

                if (nearestSquadmate) {
                    const rangeToSquadmate = creep.getRangeTo(nearestSquadmate);

                    // Heal even if undamaged to maintain continuous healing
                    creep.heal(nearestSquadmate);

                    // Move to maintain optimal healing range
                    if (rangeToSquadmate > MEDIC_FOLLOW_RANGE || rangeToSquadmate < 1) {
                        cachedMoveTo(creep, nearestSquadmate, { ignoreCreeps: true });
                    }
                }
            }
        } else {
            // All assigned squad members dead, heal any other deployed creeps
            const otherDeployedCreeps = myCreeps.filter(c =>
                c.id !== creep.id && (deployedAttackers.has(c.id) || deployedMedics.has(c.id))
            );

            if (otherDeployedCreeps.length > 0) {
                const healTarget = otherDeployedCreeps
                    .filter(c => c.hits < c.hitsMax)
                    .sort((a, b) => a.hits - b.hits)[0] || creep.findClosestByRange(otherDeployedCreeps);

                if (healTarget) {
                    creep.heal(healTarget);
                    if (creep.getRangeTo(healTarget) > MEDIC_FOLLOW_RANGE) {
                        cachedMoveTo(creep, healTarget, { ignoreCreeps: true });
                    }
                }
            } else {
                // No allies left, move toward enemy spawn
                cachedMoveTo(creep, enemySpawn, { ignoreCreeps: true });
            }
        }
    } else {
        // Base medic: heal friendlies and attack enemies in base area
        const damagedCreep = myCreeps.find(c => c.hits < c.hitsMax);

        if (damagedCreep) {
            // Priority 1: Heal damaged friendlies
            if (creep.heal(damagedCreep) === ERR_NOT_IN_RANGE) {
                cachedMoveTo(creep, damagedCreep);
            }
        } else {
            // Priority 2: Attack enemies near base
            const enemyCreeps = getAllEnemyCreeps();
            const baseThreats = enemyCreeps.filter(e => e.getRangeTo(mySpawn) <= BASE_THREAT_DETECTION_RANGE);

            if (baseThreats.length > 0) {
                const closestThreat = creep.findClosestByRange(baseThreats);
                if (closestThreat) {
                    if (creep.attack(closestThreat) === ERR_NOT_IN_RANGE) {
                        cachedMoveTo(creep, closestThreat);
                    }
                }
            } else {
                // Stay near spawn
                if (creep.getRangeTo(mySpawn) > DEFENDER_IDLE_RANGE) {
                    cachedMoveTo(creep, mySpawn);
                }
            }
        }
    }
}

/**
 * Run attacker creep behavior
 * @param {Creep} creep - The attacker creep
 * @param {StructureSpawn} mySpawn - The friendly spawn
 * @param {StructureSpawn} enemySpawn - The enemy spawn
 */
function runAttackerBehavior(creep, mySpawn, enemySpawn) {
    const isDeployed = deployedAttackers.has(creep.id);

    if (isDeployed && enemySpawn) {
        // Deployed attacker: balanced engagement - fight enemies while pushing to spawn
        const nearbyEnemy = findNearestEnemy(creep, ATTACKER_ENEMY_DETECTION_RANGE);

        if (nearbyEnemy) {
            // Engage enemy creeps encountered on the way
            if (creep.attack(nearbyEnemy) === ERR_NOT_IN_RANGE) {
                cachedMoveTo(creep, nearbyEnemy, { ignoreCreeps: true });
            }
        } else {
            // No enemies nearby - check for enemies at spawn location before attacking spawn
            const enemiesAtSpawn = getAllEnemyCreeps().filter(e =>
                e.x === enemySpawn.x && e.y === enemySpawn.y
            );

            if (enemiesAtSpawn.length > 0) {
                // Enemy creep on spawn - attack the creep instead of spawn
                const target = enemiesAtSpawn[0];
                if (creep.attack(target) === ERR_NOT_IN_RANGE) {
                    cachedMoveTo(creep, target, { ignoreCreeps: true });
                }
            } else {
                // No enemies on spawn, attack the spawn structure
                cachedMoveTo(creep, enemySpawn, { ignoreCreeps: true });
                creep.attack(enemySpawn);
            }
        }
    } else {
        // Undeployed attacker: demolish walls or wait near spawn
        if (targetWall) {
            // Actively pursue and demolish walls blocking containers
            if (creep.attack(targetWall) === ERR_NOT_IN_RANGE) {
                cachedMoveTo(creep, targetWall);
            }
        } else {
            // No walls to demolish, stay near spawn while waiting for deployment
            if (creep.getRangeTo(mySpawn) > DEFENDER_IDLE_RANGE) {
                cachedMoveTo(creep, mySpawn);
            }
        }
    }
}

/**
 * Run tower behavior - attack closest enemies
 * @param {StructureTower[]} myTowers - Array of friendly towers
 * @param {StructureSpawn} mySpawn - The friendly spawn
 */
function runTowerBehavior(myTowers, mySpawn) {
    for (const tower of myTowers) {
        const enemyCreeps = getAllEnemyCreeps();
        if (enemyCreeps.length > 0 && !tower.cooldown) {
            // Prioritize closest enemy to spawn
            const closestEnemy = mySpawn.findClosestByRange(enemyCreeps);
            if (closestEnemy) {
                tower.attack(closestEnemy);
            }
        }
    }
}

export function loop() {
    const mySpawn = getObjectsByPrototype(StructureSpawn).find(s => s.my);
    const enemySpawn = getObjectsByPrototype(StructureSpawn).find(s => !s.my);
    const myCreeps = getObjectsByPrototype(Creep).filter(c => c.my);

    cleanupDeadCreepState(myCreeps);

    // Categorize creeps by role
    const { harvesters, attackers, medics } = categorizeCreeps(myCreeps);

    manageExtensionConstruction(mySpawn, harvesters);
    deployAttackWaves(attackers, medics);
    manageBuildDefenses(mySpawn);
    executeSpawnStrategy(mySpawn, harvesters, attackers, medics);
    updateContainerWallTarget(mySpawn);

    // Execute creep behaviors
    for (const creep of myCreeps) {
        const isHarvester = creep.body.some(p => p.type === CARRY);
        const isMedic = creep.body.some(p => p.type === HEAL);

        if (isHarvester) {
            runHarvesterBehavior(creep, mySpawn);
        } else if (isMedic) {
            runMedicBehavior(creep, mySpawn, myCreeps, enemySpawn);
        } else {
            runAttackerBehavior(creep, mySpawn, enemySpawn);
        }
    }

    // Execute tower behaviors
    const myTowers = getObjectsByPrototype(StructureTower).filter(t => t.my);
    runTowerBehavior(myTowers, mySpawn);
}
