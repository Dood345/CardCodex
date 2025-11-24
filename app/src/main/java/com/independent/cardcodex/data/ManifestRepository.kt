package com.independent.cardcodex.data

import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.core_database.CardEntity
import com.independent.cardcodex.core_database.SpeciesEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ManifestRepository @Inject constructor(
    private val api: ManifestApi,
    private val cardDao: CardDao
) {

    private val _importProgress = MutableStateFlow<ImportProgress>(ImportProgress.Idle)
    val importProgress: Flow<ImportProgress> = _importProgress.asStateFlow()

    suspend fun startImport(manifestUrl: String) {
        _importProgress.value = ImportProgress.Starting
        try {
            // 1. Fetch Manifest
            val manifest = api.fetchManifest(manifestUrl)
            
            // 2. Fetch Species
            _importProgress.value = ImportProgress.FetchingSpecies
            // manifest.monstersSource is now a direct URL string
            val monsters = api.fetchMonsters(manifest.monstersSource)
            val speciesEntities = monsters.map { 
                SpeciesEntity(
                    id = it.id,
                    name = it.name.english,
                    types = it.types,
                    iconUrl = "https://img.pokemondb.net/sprites/home/normal/${it.name.english.lowercase()}.png" // Basic heuristic
                )
            }
            cardDao.insertSpecies(speciesEntities)
            
            // Map for quick lookup
            val speciesMap = speciesEntities.associateBy { it.name.lowercase() }

            // 3. Fetch Cards
            val totalSets = manifest.setsSource.size
            // manifest.setsSource is now a List<String> (URLs)
            manifest.setsSource.forEachIndexed { index, setUrl ->
                _importProgress.value = ImportProgress.FetchingCards(index + 1, totalSets)
                try {
                    val cards = api.fetchCards(setUrl)
                    cards.forEach { cardEntry ->
                        val normalizedName = PokemonNameNormalizer.normalize(cardEntry.name)
                        val speciesId = speciesMap[normalizedName.lowercase()]?.id
                        
                        val cardEntity = CardEntity(
                            cardId = cardEntry.id,
                            speciesId = speciesId,
                            name = cardEntry.name,
                            set = cardEntry.set,
                            imageUrl = cardEntry.imageUrl
                        )
                        cardDao.insertCard(cardEntity)
                    }
                } catch (e: Exception) {
                    // Log error but continue with other sets
                    e.printStackTrace()
                }
            }
            _importProgress.value = ImportProgress.Completed
        } catch (e: Exception) {
            _importProgress.value = ImportProgress.Error(e.message ?: "Unknown error")
        }
    }
}

sealed class ImportProgress {
    object Idle : ImportProgress()
    object Starting : ImportProgress()
    object FetchingSpecies : ImportProgress()
    data class FetchingCards(val current: Int, val total: Int) : ImportProgress()
    object Completed : ImportProgress()
    data class Error(val message: String) : ImportProgress()
}
