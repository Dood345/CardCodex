package com.independent.cardcodex.feature_pokedex

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.core_database.CardEntity
import com.independent.cardcodex.core_database.SpeciesEntity
import com.independent.cardcodex.data.ImportProgress
import com.independent.cardcodex.data.ManifestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

import com.independent.cardcodex.ui.util.EnergyIconProvider

@HiltViewModel
class PokedexViewModel @Inject constructor(
    private val repository: ManifestRepository,
    private val cardDao: CardDao,
    private val energyIconProvider: EnergyIconProvider
) : ViewModel() {

    val importProgress: StateFlow<ImportProgress> = repository.importProgress
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), ImportProgress.Idle)

    val codexEntries: StateFlow<List<CodexEntry>> = kotlinx.coroutines.flow.combine(
        cardDao.getAllSpecies(),
        cardDao.getUncategorizedCards()
    ) { speciesList, uncategorizedList ->
        val speciesEntries = speciesList.map { species ->
            CodexEntry(
                id = species.id.toString(),
                name = species.name,
                iconUrl = species.iconUrl,
                type = species.types.firstOrNull(),
                isSpecies = true,
                speciesId = species.id
            )
        }

        val otherEntries = uncategorizedList
            .groupBy { it.name }
            .map { (name, cards) ->
                val firstCard = cards.first()
                
                var iconUrl = firstCard.imageUrl
                if (firstCard.supertype == "Energy") {
                     val energyType = name.substringBefore(" Energy").trim()
                     iconUrl = energyIconProvider.getIconUrl(energyType) ?: firstCard.imageUrl
                }

                CodexEntry(
                    id = name,
                    name = name,
                    iconUrl = iconUrl,
                    type = firstCard.supertype ?: "Trainer",
                    isSpecies = false,
                    speciesId = null
                )
            }
            .sortedBy { it.name }

        speciesEntries + otherEntries
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun startImport(url: String) {
        viewModelScope.launch {
            repository.startImport(url)
        }
    }
}
