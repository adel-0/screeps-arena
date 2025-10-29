import { getObjectsByPrototype, createConstructionSite, getTicks, findPath, getDirection } from 'game/utils';
import { Creep, StructureSpawn, Source, StructureContainer, StructureTower, ConstructionSite, StructureExtension, StructureWall } from 'game/prototypes';
import { MOVE, ATTACK, RANGED_ATTACK, WORK, CARRY, RESOURCE_ENERGY, ERR_NOT_IN_RANGE, HEAL, TOUGH } from 'game/constants';

let creepPaths = {}; // Cache paths: { creepId: { target: targetId, tick: lastCalculatedTick } }
let targetWalls = []; // Walls blocking access to containers
let deployedAttackers = new Set(); // Track which attackers are deployed to attack
let deployedMedics = new Set(); // Track which medics are deployed for combat support
let squadAssignments = {}; // Map creep ID to squad name (e.g., "Alpha", "Bravo", "Charlie")
let squadLeaders = {}; // Map squad name to leader creep ID
let squadTargets = {}; // Map squad name to designated target enemy ID
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
const SQUAD_COHESION_RANGE = 4; // Max distance followers can be from squad leader
const HARVESTER_FLEE_RANGE = 5; // Range at which harvesters flee from enemies

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
 * Find the most damaged creep from an array of creeps
 * @param {Creep[]} creeps - Array of creeps to search
 * @returns {Creep|null} Most damaged creep or null if none damaged
 */
function findMostDamagedCreep(creeps) {
    return creeps
        .filter(c => c.hits < c.hitsMax)
        .sort((a, b) => a.hits - b.hits)[0] || null;
}

/**
 * Get all squad members for a given creep
 * @param {Creep} creep - The creep whose squad to find
 * @param {Creep[]} allCreeps - All friendly creeps
 * @param {boolean} attackersOnly - If true, only return attackers
 * @returns {Creep[]} Array of squad member creeps
 */
function getSquadMembers(creep, allCreeps, attackersOnly = false) {
    const squad = squadAssignments[creep.id];
    return allCreeps.filter(c =>
        c.id !== creep.id &&
        squadAssignments[c.id] === squad &&
        (!attackersOnly || deployedAttackers.has(c.id))
    );
}

/**
 * Get the squad leader for a given creep
 * @param {Creep} creep - The creep whose squad leader to find
 * @param {Creep[]} allCreeps - All friendly creeps
 * @returns {Creep|null} Squad leader creep or null if not found
 */
function getSquadLeader(creep, allCreeps) {
    const squad = squadAssignments[creep.id];
    if (!squad || !squadLeaders[squad]) {
        return null;
    }

    const leaderId = squadLeaders[squad];
    return allCreeps.find(c => c.id === leaderId) || null;
}

/**
 * Check if a creep is the leader of their squad
 * @param {Creep} creep - The creep to check
 * @returns {boolean} True if creep is squad leader
 */
function isSquadLeader(creep) {
    const squad = squadAssignments[creep.id];
    return squad && squadLeaders[squad] === creep.id;
}

/**
 * Get the designated target for a squad
 * @param {Creep} creep - The creep whose squad target to find
 * @param {Creep[]} allEnemyCreeps - All enemy creeps
 * @returns {Creep|null} Designated target creep or null if not found
 */
function getSquadTarget(creep, allEnemyCreeps) {
    const squad = squadAssignments[creep.id];
    if (!squad || !squadTargets[squad]) {
        return null;
    }

    const targetId = squadTargets[squad];
    return allEnemyCreeps.find(e => e.id === targetId) || null;
}

/**
 * Set the designated target for a squad
 * @param {Creep} leaderCreep - The squad leader creep
 * @param {Creep} targetEnemy - The enemy to designate as target
 */
function setSquadTarget(leaderCreep, targetEnemy) {
    const squad = squadAssignments[leaderCreep.id];
    if (squad) {
        squadTargets[squad] = targetEnemy ? targetEnemy.id : null;
    }
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

    // Cleanup objects and sets using unified approach
    const objectsToClean = [creepPaths, squadAssignments];
    const setsToClean = [deployedAttackers, deployedMedics];

    for (const obj of objectsToClean) {
        for (const creepId in obj) {
            if (!aliveCreepIds.has(creepId)) {
                delete obj[creepId];
            }
        }
    }

    for (const set of setsToClean) {
        for (const creepId of set) {
            if (!aliveCreepIds.has(creepId)) {
                set.delete(creepId);
            }
        }
    }

    // Clean up squad leaders if the leader is dead or reassign if needed
    for (const squadName in squadLeaders) {
        const leaderId = squadLeaders[squadName];
        if (!aliveCreepIds.has(leaderId)) {
            // Find a new leader from remaining squad members
            const remainingMembers = myCreeps.filter(c =>
                squadAssignments[c.id] === squadName &&
                deployedAttackers.has(c.id)
            );

            if (remainingMembers.length > 0) {
                // Assign first remaining attacker as new leader
                squadLeaders[squadName] = remainingMembers[0].id;
            } else {
                // No members left, remove squad leader entry
                delete squadLeaders[squadName];
            }
        }
    }
}

/**
 * Clean up designated targets that are no longer alive
 * @param {Creep[]} enemyCreeps - Array of currently alive enemy creeps
 */
function cleanupDeadTargets(enemyCreeps) {
    const aliveEnemyIds = new Set(enemyCreeps.map(e => e.id));

    for (const squadName in squadTargets) {
        const targetId = squadTargets[squadName];
        if (targetId && !aliveEnemyIds.has(targetId)) {
            delete squadTargets[squadName];
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
 * @param {StructureSpawn} mySpawn - The friendly spawn
 */
function deployAttackWaves(attackers, medics, mySpawn) {
    const undeployedAttackers = attackers.filter(a => !deployedAttackers.has(a.id));
    const undeployedMedics = medics.filter(d => !deployedMedics.has(d.id));

    // Don't deploy while spawn is actively spawning to ensure all squad members are ready
    if (mySpawn && mySpawn.spawning) {
        return;
    }

    // Deploy complete squads only when we have enough units
    if (undeployedAttackers.length >= ATTACKERS_PER_SQUAD && undeployedMedics.length >= MEDICS_PER_SQUAD) {
        const squadName = NATO_ALPHABET[nextSquadIndex % NATO_ALPHABET.length];

        // Deploy attackers - first one becomes squad leader
        for (let i = 0; i < ATTACKERS_PER_SQUAD; i++) {
            const attacker = undeployedAttackers[i];
            deployedAttackers.add(attacker.id);
            squadAssignments[attacker.id] = squadName;

            // Designate first attacker as squad leader
            if (i === 0) {
                squadLeaders[squadName] = attacker.id;
            }
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
            // First harvester: cheap 2C2M for early bootstrap
            // Subsequent harvesters: efficient 3C3M for better throughput
            if (harvesters.length === 0) {
                mySpawn.spawnCreep([CARRY, CARRY, MOVE, MOVE]);
            } else {
                mySpawn.spawnCreep([CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]);
            }
        } else {
            // Phase 2: Build squads - maintain ratio of 3 attackers per 1 medic
            const undeployedAttackers = attackers.filter(a => !deployedAttackers.has(a.id));
            const undeployedMedics = medics.filter(m => !deployedMedics.has(m.id));

            if (undeployedAttackers.length >= ATTACKERS_PER_SQUAD && undeployedMedics.length < MEDICS_PER_SQUAD) {
                // Need medic to complete squad
                mySpawn.spawnCreep([MOVE, MOVE, HEAL, HEAL]);
            } else {
                // Spawn resilient melee attackers with TOUGH parts at beginning
                // Alternating ATTACK/MOVE spreads critical parts for gradual capability loss under fire
                // TOUGH parts absorb initial damage (damage applies from start of array)
                mySpawn.spawnCreep([TOUGH, TOUGH, ATTACK, MOVE, ATTACK, MOVE, ATTACK, MOVE]);
            }
        }
    }
}

/**
 * Initialize target walls based on spawn position
 * @param {StructureSpawn} mySpawn - The friendly spawn
 */
function initializeTargetWalls(mySpawn) {
    if (targetWalls.length === 0) {
        const walls = getObjectsByPrototype(StructureWall);
        let wallPositions = [];

        // Determine wall positions based on spawn location
        if (mySpawn.x === 5 && mySpawn.y === 45) {
            wallPositions = [{ x: 2, y: 46 }, { x: 11, y: 44 }];
        } else if (mySpawn.x === 94 && mySpawn.y === 54) {
            wallPositions = [{ x: 97, y: 55 }, { x: 88, y: 55 }];
        }

        // Find actual wall objects at those positions
        targetWalls = walls.filter(wall =>
            wallPositions.some(pos => wall.x === pos.x && wall.y === pos.y)
        );
    }
}

/**
 * Run harvester creep behavior
 * @param {Creep} creep - The harvester creep
 * @param {StructureSpawn} mySpawn - The friendly spawn
 */
function runHarvesterBehavior(creep, mySpawn) {
    // Priority: Flee from nearby enemies
    const nearbyEnemy = findNearestEnemy(creep, HARVESTER_FLEE_RANGE);

    if (nearbyEnemy) {
        // Calculate flee direction: move away from enemy toward spawn
        const fleeDirection = {
            x: creep.x + (creep.x - nearbyEnemy.x),
            y: creep.y + (creep.y - nearbyEnemy.y)
        };

        // Move toward spawn while fleeing
        cachedMoveTo(creep, mySpawn);
        return;
    }

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
        // Deployed combat medic: follow squad leader and heal squad members
        const leader = getSquadLeader(creep, myCreeps);
        const squadmates = getSquadMembers(creep, myCreeps, true);

        if (squadmates.length > 0 || leader) {
            // Heal squad members (prioritize damaged)
            const damagedSquadmate = findMostDamagedCreep(squadmates);

            if (damagedSquadmate) {
                // Priority: Heal wounded squad members
                if (creep.heal(damagedSquadmate) === ERR_NOT_IN_RANGE) {
                    cachedMoveTo(creep, damagedSquadmate, { ignoreCreeps: true });
                }
            } else {
                // No wounded - follow leader and heal continuously
                const healTarget = leader || squadmates[0];

                if (healTarget) {
                    const rangeToTarget = creep.getRangeTo(healTarget);

                    // Continuously heal even if undamaged
                    creep.heal(healTarget);

                    // Follow the leader to maintain formation
                    if (rangeToTarget > MEDIC_FOLLOW_RANGE || rangeToTarget < 1) {
                        cachedMoveTo(creep, healTarget, { ignoreCreeps: true });
                    }
                }
            }
        } else {
            // All assigned squad members dead, heal any other deployed creeps
            const otherDeployedCreeps = myCreeps.filter(c =>
                c.id !== creep.id && (deployedAttackers.has(c.id) || deployedMedics.has(c.id))
            );

            if (otherDeployedCreeps.length > 0) {
                const healTarget = findMostDamagedCreep(otherDeployedCreeps) ||
                    creep.findClosestByRange(otherDeployedCreeps);

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
 * @param {Creep[]} myCreeps - All friendly creeps
 */
function runAttackerBehavior(creep, mySpawn, enemySpawn, myCreeps) {
    const isDeployed = deployedAttackers.has(creep.id);

    if (isDeployed && enemySpawn) {
        const leader = getSquadLeader(creep, myCreeps);
        const isLeader = isSquadLeader(creep);
        const allEnemies = getAllEnemyCreeps();

        // Check cohesion for followers
        if (!isLeader && leader) {
            const rangeToLeader = creep.getRangeTo(leader);

            // If too far from leader, prioritize returning to formation
            if (rangeToLeader > SQUAD_COHESION_RANGE) {
                cachedMoveTo(creep, leader, { ignoreCreeps: true });
                // Still attack nearby enemies while regrouping
                const nearbyEnemy = findNearestEnemy(creep, 1);
                if (nearbyEnemy) {
                    creep.attack(nearbyEnemy);
                }
                return;
            }
        }

        // Leader designates target for the squad
        if (isLeader) {
            const currentTarget = getSquadTarget(creep, allEnemies);

            // Keep current target if still valid and in detection range
            if (!currentTarget || creep.getRangeTo(currentTarget) > ATTACKER_ENEMY_DETECTION_RANGE) {
                // Find new target - prioritize nearest enemy
                const nearbyEnemy = findNearestEnemy(creep, ATTACKER_ENEMY_DETECTION_RANGE);
                setSquadTarget(creep, nearbyEnemy);
            }
        }

        // All squad members attack the designated target
        const designatedTarget = getSquadTarget(creep, allEnemies);

        if (designatedTarget) {
            const rangeToTarget = creep.getRangeTo(designatedTarget);

            // Attack designated target if in range
            if (rangeToTarget <= 1) {
                creep.attack(designatedTarget);
                // Move closer if not adjacent
                if (rangeToTarget > 0) {
                    cachedMoveTo(creep, designatedTarget, { ignoreCreeps: true });
                }
            } else {
                // Designated target out of range - attack nearby enemy but move toward designated target
                const nearbyEnemy = findNearestEnemy(creep, 1);
                if (nearbyEnemy) {
                    creep.attack(nearbyEnemy);
                }
                cachedMoveTo(creep, designatedTarget, { ignoreCreeps: true });
            }
        } else {
            // No designated target - check for enemies at spawn location before attacking spawn
            const enemiesAtSpawn = allEnemies.filter(e =>
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
                // Followers: move toward leader's position if leader exists, otherwise toward spawn
                if (!isLeader && leader) {
                    cachedMoveTo(creep, leader, { ignoreCreeps: true });
                } else {
                    cachedMoveTo(creep, enemySpawn, { ignoreCreeps: true });
                }
                creep.attack(enemySpawn);
            }
        }
    } else {
        // Undeployed attacker: defend if under attack, otherwise demolish walls or wait near spawn
        const nearbyEnemy = findNearestEnemy(creep, ATTACKER_ENEMY_DETECTION_RANGE);

        if (nearbyEnemy) {
            // Enemy nearby - defend yourself even while waiting for deployment
            if (creep.attack(nearbyEnemy) === ERR_NOT_IN_RANGE) {
                cachedMoveTo(creep, nearbyEnemy);
            }
        } else {
            // No threats - proceed with wall demolition or idle
            // Filter out destroyed walls
            const remainingWalls = targetWalls.filter(wall => wall.hits !== undefined);

            if (remainingWalls.length > 0) {
                // Actively pursue and demolish walls blocking containers
                const closestWall = creep.findClosestByRange(remainingWalls);
                if (closestWall && creep.attack(closestWall) === ERR_NOT_IN_RANGE) {
                    cachedMoveTo(creep, closestWall);
                }
            } else {
                // No walls to demolish, stay near spawn while waiting for deployment
                if (creep.getRangeTo(mySpawn) > DEFENDER_IDLE_RANGE) {
                    cachedMoveTo(creep, mySpawn);
                }
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
    const enemyCreeps = getAllEnemyCreeps();

    cleanupDeadCreepState(myCreeps);
    cleanupDeadTargets(enemyCreeps);

    // Categorize creeps by role
    const { harvesters, attackers, medics } = categorizeCreeps(myCreeps);

    manageExtensionConstruction(mySpawn, harvesters);
    deployAttackWaves(attackers, medics, mySpawn);
    manageBuildDefenses(mySpawn);
    executeSpawnStrategy(mySpawn, harvesters, attackers, medics);
    initializeTargetWalls(mySpawn);

    // Execute creep behaviors
    for (const creep of myCreeps) {
        const isHarvester = creep.body.some(p => p.type === CARRY);
        const isMedic = creep.body.some(p => p.type === HEAL);

        if (isHarvester) {
            runHarvesterBehavior(creep, mySpawn);
        } else if (isMedic) {
            runMedicBehavior(creep, mySpawn, myCreeps, enemySpawn);
        } else {
            runAttackerBehavior(creep, mySpawn, enemySpawn, myCreeps);
        }
    }

    // Execute tower behaviors
    const myTowers = getObjectsByPrototype(StructureTower).filter(t => t.my);
    runTowerBehavior(myTowers, mySpawn);
}
