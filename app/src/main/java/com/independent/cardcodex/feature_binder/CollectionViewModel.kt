package com.independent.cardcodex.feature_binder

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.feature_pokedex.CodexCategory
import com.independent.cardcodex.feature_pokedex.CodexEntry
import com.independent.cardcodex.ui.util.EnergyIconProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class CollectionViewModel @Inject constructor(
    private val cardDao: CardDao,
    private val energyIconProvider: EnergyIconProvider
) : ViewModel() {

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _selectedCategory = MutableStateFlow(CodexCategory.All)
    val selectedCategory: StateFlow<CodexCategory> = _selectedCategory.asStateFlow()

    val collectionEntries: StateFlow<List<CodexEntry>> = combine(
        cardDao.getSpeciesCollectionStatus(),
        cardDao.getOwnedUncategorizedCards(),
        _searchQuery,
        _selectedCategory
    ) { speciesStatusList, uncategorizedList, query, category ->
        // 1. Map Species (Owned & Unowned)
        val speciesEntries = speciesStatusList
            .map { status ->
                CodexEntry(
                    id = status.species.id.toString(),
                    name = status.species.name,
                    iconUrl = status.species.iconUrl,
                    type = status.species.types.firstOrNull(),
                    isSpecies = true,
                    speciesId = status.species.id,
                    isOwned = status.isOwned
                )
            }

        // 2. Map Owned Uncategorized (Trainers/Energy)
        val otherEntries = uncategorizedList.map { card ->
            var iconUrl = card.imageUrl
            if (card.supertype == "Energy") {
                 val energyType = card.name.substringBefore(" Energy").trim()
                 iconUrl = energyIconProvider.getIconUrl(energyType) ?: card.imageUrl
            }

            CodexEntry(
                id = card.name, // Grouping key
                name = card.name,
                iconUrl = iconUrl,
                type = card.supertype ?: "Trainer",
                isSpecies = false,
                speciesId = null
            )
        }

        val allEntries = speciesEntries + otherEntries

        // 3. Filter & Sort
        allEntries
            .filter { entry -> 
                (query.isBlank() || entry.name.contains(query, ignoreCase = true)) &&
                when (category) {
                    CodexCategory.All -> true
                    CodexCategory.Pokemon -> entry.isSpecies
                    CodexCategory.Trainer -> !entry.isSpecies && entry.type == "Trainer"
                    CodexCategory.Energy -> !entry.isSpecies && entry.type == "Energy"
                }
            }
            .sortedWith(compareBy<CodexEntry> { 
                when {
                    it.isSpecies -> 0
                    it.type == "Trainer" -> 1
                    it.type == "Energy" -> 2
                    else -> 3
                }
            }.thenBy { 
                if (it.isSpecies) it.speciesId else 0 
            }.thenBy { 
                it.name 
            })

    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun onSearchQueryChange(query: String) {
        _searchQuery.value = query
    }

    fun onCategorySelect(category: CodexCategory) {
        _selectedCategory.value = category
    }
}
